import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { REDIS } from 'src/infra/cache/redis.client';
import { DRIZZLE } from 'src/infra/database/drizzle-client';
import type * as schema from 'src/infra/database/schemas';
import { botEvents, saleAttempts } from 'src/infra/database/schemas';
import { FAKE_CUSTOMERS } from 'src/integrations/revgas/customers/customers.fixtures';
import type { FakeRevgasClient } from 'src/integrations/revgas/fake-revgas.client';
import { REVGAS_CLIENT } from 'src/integrations/revgas/revgas.client';
import type { FakeWhatsappClient } from 'src/integrations/whatsapp/fake-whatsapp.client';
import { textWebhook, webhookPayload } from 'src/integrations/whatsapp/testing/webhook.testing';
import { signPayload } from 'src/integrations/whatsapp/webhook/signature';
import { WHATSAPP_CLIENT } from 'src/integrations/whatsapp/whatsapp.client';
import {
  ConversationRepository,
  IDENTITY_PREFIX,
  INBOUND_PREFIX,
  ORDER_PREFIX,
  REMINDER_SET,
} from 'src/modules/conversation/conversation.repository';
import { HandoffRepository, QUEUE_SNAPSHOT_PREFIX } from 'src/modules/handoff/handoff.repository';
import { QueueSnapshotScheduler } from 'src/modules/handoff/queue-snapshot.scheduler';
import supertest from 'supertest';
import { createApp } from '../setup-e2e';

const SECRET = 'e2e-whatsapp-app-secret-0123456789';

describe('Eventos do bot (e2e)', () => {
  let app: NestFastifyApplication;
  let whatsapp: FakeWhatsappClient;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  let conversations: ConversationRepository;
  const phone = `55869${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const ids: string[] = [];
  const cycles: string[] = [];

  async function post(value: string, choice = false) {
    const id = `metrics.${randomUUID()}`;
    ids.push(id);
    const payload = choice
      ? webhookPayload({
          messages: [
            {
              from: phone,
              id,
              timestamp: '1760000000',
              type: 'interactive',
              interactive: { type: 'list_reply', list_reply: { id: value, title: value } },
            },
          ],
        })
      : textWebhook(value, id, phone);
    const raw = JSON.stringify(payload);
    await supertest(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signPayload(raw, SECRET))
      .send(raw)
      .expect(200);
    await vi.waitFor(() => expect(whatsapp.sent.length).toBeGreaterThan(0));
  }

  beforeAll(async () => {
    app = await createApp();
    whatsapp = app.get(WHATSAPP_CLIENT);
    redis = app.get(REDIS);
    db = app.get(DRIZZLE);
    conversations = app.get(ConversationRepository);
    const revgas = app.get<FakeRevgasClient>(REVGAS_CLIENT);
    const { id: _id, ...customer } = FAKE_CUSTOMERS[0];
    await revgas.customers.create({ ...customer, phones: [phone] });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (cycles.length) await db.delete(botEvents).where(inArray(botEvents.cycleId, cycles));
    await redis.del(
      `${ORDER_PREFIX}:${phone}`,
      `${IDENTITY_PREFIX}:${phone}`,
      ...ids.map(id => `${INBOUND_PREFIX}:${id}`),
    );
    await redis.zrem(REMINDER_SET, phone);
    await app.close();
  });

  it('grava turnos e venda sem dados pessoais nas colunas', async () => {
    await post('oi');
    const cycleId = (await conversations.loadOrder(phone))?.cycleId;
    expect(cycleId).toBeTruthy();
    cycles.push(cycleId as string);
    for (const [value, choice] of [
      [FAKE_CUSTOMERS[0].cpf ?? '', false],
      ['address:0', true],
      ['product:900000101', true],
      ['qty:1', true],
      ['pay:PIX', true],
      ['summary:confirm:1', true],
    ] as const) {
      whatsapp.clear();
      await post(value, choice);
    }
    await vi.waitFor(
      async () => {
        const events = await db
          .select()
          .from(botEvents)
          .where(eq(botEvents.cycleId, cycleId as string));
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'turn' }),
            expect.objectContaining({ name: 'sale', outcome: 'created' }),
          ]),
        );
        expect(
          JSON.stringify(events, (_key, value) =>
            typeof value === 'bigint' ? value.toString() : value,
          ),
        ).not.toContain(phone);
        expect(Object.keys(events[0]).sort()).toEqual(
          [
            'id',
            'occurredAt',
            'name',
            'cycleId',
            'handoffId',
            'prevStep',
            'step',
            'outcome',
            'reason',
            'durationMs',
            'amount',
            'isSimulated',
          ].sort(),
        );
      },
      { timeout: 2000 },
    );
  });

  it('insert rejeitado mantém exatamente as mensagens enviadas', async () => {
    whatsapp.clear();
    await conversations.clearOrder(phone);
    await post('oi');
    const before = whatsapp.sent.map(sent => sent.body);
    cycles.push((await conversations.loadOrder(phone))?.cycleId as string);
    await conversations.clearOrder(phone);
    whatsapp.clear();
    const insert = vi
      .spyOn(db, 'insert')
      .mockReturnValue({ values: () => Promise.reject(new Error('insert rejeitado')) } as never);
    await post('oi');
    expect(whatsapp.sent.map(sent => sent.body)).toEqual(before);
    cycles.push((await conversations.loadOrder(phone))?.cycleId as string);
    insert.mockRestore();
  });

  it('classifica eventos antigos como simulados e mantém o default true', async () => {
    const cycleId = randomUUID();
    cycles.push(cycleId);
    await db.execute(
      sql`INSERT INTO bot_events (name, cycle_id) VALUES ('order_cancelled', ${cycleId}::uuid)`,
    );
    const [row] = await db
      .select({ isSimulated: botEvents.isSimulated })
      .from(botEvents)
      .where(eq(botEvents.cycleId, cycleId));
    expect(row?.isSimulated).toBe(true);
    const column = await db.execute(
      sql`SELECT is_nullable, column_default FROM information_schema.columns
          WHERE table_name = 'bot_events' AND column_name = 'is_simulated'`,
    );
    expect(column.rows).toEqual([{ is_nullable: 'NO', column_default: 'true' }]);
  });

  describe('SQLs P0 do painel sobre fixture sintética', () => {
    type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];
    type Row = Record<string, number | string | null>;

    const HOUR = 3_600_000;
    const ago = (hours: number) => new Date(Date.now() - hours * HOUR);
    const sqlDir = resolve(process.cwd(), 'docs/guides/metrics/sql');
    const read = (file: string) => readFileSync(resolve(sqlDir, file), 'utf8');
    const code = (file: string) => read(file).replace(/--.*$/gm, '');
    const ROLLBACK = new Error('rollback da fixture');

    function validDays(days: unknown): number {
      if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) {
        throw new RangeError('dias deve ser inteiro entre 1 e 365');
      }
      return days;
    }

    const PLACEHOLDER = /(\{\{dias\}\}|\{\{incluir_simulados\}\})/;

    function bound(file: string, days: unknown, mode: string = 'nao') {
      return read(file)
        .split(PLACEHOLDER)
        .map(part =>
          part === '{{dias}}'
            ? sql`${days}`
            : part === '{{incluir_simulados}}'
              ? sql`${mode}`
              : sql.raw(part),
        )
        .reduce((acc, part) => sql`${acc}${part}`);
    }

    function pasted(file: string, days: number, mode: string = 'nao') {
      return sql.raw(
        read(file)
          .replaceAll('{{dias}}', String(days))
          .replaceAll('{{incluir_simulados}}', `'${mode}'`),
      );
    }

    function toRows(rows: Record<string, unknown>[]): Row[] {
      return rows.map(
        row =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value,
            ]),
          ) as Row,
      );
    }

    async function query(tx: Tx, file: string, days: unknown = 30, mode: string = 'nao') {
      const { rows } = await tx.execute(bound(file, validDays(days), mode));
      return toRows(rows);
    }

    async function isolated<T>(
      run: (tx: Tx) => Promise<T>,
      seed: (tx: Tx) => Promise<void> = seedFixture,
    ): Promise<T> {
      let result: T | undefined;
      try {
        await db.transaction(async tx => {
          await tx.execute(
            sql`CREATE TEMP TABLE bot_events (LIKE public.bot_events INCLUDING ALL) ON COMMIT DROP`,
          );
          await tx.execute(
            sql`CREATE TEMP TABLE sale_attempts (LIKE public.sale_attempts INCLUDING ALL) ON COMMIT DROP`,
          );
          await seed(tx);
          result = await run(tx);
          throw ROLLBACK;
        });
      } catch (error) {
        if (error !== ROLLBACK) throw error;
      }
      return result as T;
    }

    type Attempt = {
      cycleId: string;
      status: string;
      totalCents?: number;
      productCode?: string;
      paymentMethodCode?: string;
      errorKind?: string;
      customerSegment?: string;
      isSimulated?: boolean;
      createdAt?: Date;
    };

    const attempt = (a: Attempt) => ({
      cycleId: a.cycleId,
      status: a.status,
      totalCents: a.totalCents ?? 14000,
      productCode: a.productCode ?? 'P13',
      paymentMethodCode: a.paymentMethodCode ?? 'PIX',
      customerSegment: a.customerSegment ?? 'unknown',
      errorKind: a.errorKind ?? null,
      isSimulated: a.isSimulated ?? false,
      customerId: 1,
      createdAt: (a.createdAt ?? ago(72)).toISOString(),
    });

    type Event = typeof botEvents.$inferInsert;
    const event = (e: Event): Event => ({ isSimulated: false, ...e });

    const cycle = () => randomUUID();
    const automatic = Array.from({ length: 5 }, cycle);
    const human = Array.from({ length: 2 }, cycle);
    const abandoned = [cycle(), cycle()];
    const pending = cycle();
    const registered = [...automatic, ...human];
    const handoffs = [randomUUID(), randomUUID()];

    const utcDay = (daysBack: number, hour: number) => {
      const now = new Date();
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack, hour),
      );
    };
    const registeredHours = [14, 14, 14, 14, 18, 18, 18];
    const abandonedHours = [10, 10];

    const profile = [
      ['P13', 'PIX', 'new'],
      ['P13', 'PIX', 'new'],
      ['P13', 'PIX', 'new'],
      ['P13', 'DINHEIRO', 'recurring'],
      ['P45', 'PIX', 'recurring'],
      ['P45', 'PIX', 'recurring'],
      ['P45', 'DINHEIRO', 'recurring'],
    ] as const;

    async function seedFixture(tx: Tx) {
      const events: Event[] = [];
      for (const [index, cycleId] of registered.entries()) {
        events.push(
          event({
            name: 'purchase_started',
            cycleId,
            reason: 'new',
            occurredAt: utcDay(3, registeredHours[index]),
          }),
          event({
            name: 'turn',
            cycleId,
            step: 'summary',
            durationMs: 400,
            occurredAt: ago(71),
          }),
          event({
            name: 'sale',
            cycleId,
            outcome: 'created',
            reason: 'direct',
            occurredAt: ago(70),
          }),
        );
      }
      for (const [index, handoffId] of handoffs.entries()) {
        const cycleId = human[index];
        events.push(
          event({
            name: 'handoff',
            cycleId,
            handoffId,
            outcome: 'pending',
            reason: 'customer_request',
            occurredAt: ago(71.5),
          }),
          event({
            name: 'handoff_assumed',
            cycleId,
            handoffId,
            durationMs: index === 0 ? 120_000 : 600_000,
            occurredAt: ago(71.4),
          }),
          event({
            name: 'handoff_resolved',
            cycleId,
            handoffId,
            durationMs: 900_000,
            occurredAt: ago(71.2),
          }),
        );
      }
      for (const [index, cycleId] of abandoned.entries()) {
        events.push(
          event({
            name: 'purchase_started',
            cycleId,
            reason: 'unknown',
            occurredAt: utcDay(5, abandonedHours[index]),
          }),
          event({
            name: 'turn',
            cycleId,
            prevStep: 'chooseAddress',
            step: index === 0 ? 'catalog' : 'payment',
            durationMs: 400,
            occurredAt: ago(50),
          }),
        );
      }
      events.push(
        event({
          name: 'purchase_started',
          cycleId: pending,
          reason: 'unknown',
          occurredAt: ago(2),
        }),
        event({
          name: 'turn',
          cycleId: pending,
          step: 'summary',
          durationMs: 400,
          occurredAt: ago(1.5),
        }),
        event({
          name: 'ai_call',
          outcome: 'allowed',
          reason: 'interpret',
          amount: 1,
          occurredAt: ago(71),
        }),
        event({
          name: 'ai_call',
          outcome: 'allowed',
          reason: 'question',
          amount: 1,
          occurredAt: ago(71),
        }),
        event({
          name: 'ai_call',
          outcome: 'allowed',
          reason: 'address',
          amount: 1,
          occurredAt: ago(50),
        }),
        event({
          name: 'ai_call',
          outcome: 'limited',
          reason: 'interpret',
          amount: 1,
          occurredAt: ago(50),
        }),
        event({
          name: 'ai_call',
          outcome: 'limited',
          reason: 'interpret',
          amount: 1,
          occurredAt: ago(50),
          isSimulated: true,
        }),
        event({
          name: 'sale_outcome_unknown',
          cycleId: pending,
          reason: 'timeout',
          occurredAt: ago(1),
        }),
      );
      const simulatedCycle = cycle();
      events.push(
        event({
          name: 'purchase_started',
          cycleId: simulatedCycle,
          reason: 'new',
          occurredAt: ago(60),
          isSimulated: true,
        }),
        event({
          name: 'turn',
          cycleId: simulatedCycle,
          step: 'catalog',
          occurredAt: ago(50),
          isSimulated: true,
        }),
        event({
          name: 'handoff_assumed',
          handoffId: randomUUID(),
          durationMs: 3_600_000,
          occurredAt: ago(48),
          isSimulated: true,
        }),
        event({ name: 'handoff_assumed', handoffId: randomUUID(), occurredAt: ago(48) }),
        event({
          name: 'handoff_assumed',
          handoffId: randomUUID(),
          durationMs: 7_200_000,
          occurredAt: ago(24 * 200),
        }),
      );
      await tx.insert(botEvents).values(events);

      const attempts = registered.map((cycleId, index) =>
        attempt({
          cycleId,
          status: 'registered',
          productCode: profile[index][0],
          paymentMethodCode: profile[index][1],
          customerSegment: profile[index][2],
        }),
      );
      attempts.push(
        attempt({
          cycleId: pending,
          status: 'uncertain',
          errorKind: 'timeout',
          createdAt: ago(1),
        }),
        attempt({
          cycleId: simulatedCycle,
          status: 'registered',
          totalCents: 99_900,
          isSimulated: true,
        }),
        attempt({ cycleId: cycle(), status: 'registered', totalCents: 99_900, isSimulated: true }),
        attempt({ cycleId: cycle(), status: 'uncertain', isSimulated: true }),
        attempt({ cycleId: cycle(), status: 'rejected', totalCents: 88_800 }),
        attempt({ cycleId: cycle(), status: 'pending', totalCents: 77_700 }),
        attempt({
          cycleId: cycle(),
          status: 'registered',
          totalCents: 66_600,
          createdAt: ago(24 * 400),
        }),
      );
      await tx.insert(saleAttempts).values(attempts);
    }

    const empty = async () => {};

    it('exclui tentativas simuladas do valor vendido por padrão', async () => {
      const { simulated, row, mix } = await isolated(async tx => {
        const total = await tx.execute(
          sql`SELECT count(*) AS n FROM sale_attempts WHERE is_simulated = true AND status = 'registered'`,
        );
        const groups = await tx.execute(
          sql`SELECT product_code, payment_method_code, customer_segment, count(*) AS n
              FROM sale_attempts WHERE status = 'registered' AND is_simulated = false AND created_at >= now() - interval '30 days'
              GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
        );
        return {
          simulated: Number(total.rows[0]?.n),
          row: (await query(tx, 'gestor-vendas.sql'))[0],
          mix: groups.rows.map(
            g => `${g.product_code}/${g.payment_method_code}/${g.customer_segment}=${g.n}`,
          ),
        };
      });
      expect(simulated).toBeGreaterThan(0);
      expect(row).toEqual({
        pedidos_registrados: 7,
        valor_registrado_brl: 980,
        ticket_medio_brl: 140,
        resultado_incerto: 1,
      });
      expect(mix).toEqual([
        'P13/DINHEIRO/recurring=1',
        'P13/PIX/new=3',
        'P45/DINHEIRO/recurring=1',
        'P45/PIX/recurring=2',
      ]);
    });

    it('calcula 7 vendas em 9 ciclos maduros', async () => {
      const [row] = await isolated(tx => query(tx, 'gestor-conversao.sql'));
      expect(row).toMatchObject({
        intencoes_maduras: 9,
        pedidos_em_intencoes_maduras: 7,
        conversao_madura_pct: 77.8,
      });
    });

    it('calcula 7 vendas em 10 intenções totais', async () => {
      const [row] = await isolated(tx => query(tx, 'gestor-conversao.sql'));
      expect(row).toMatchObject({
        intencoes_totais: 10,
        pedidos_em_intencoes_totais: 7,
        conversao_total_pct: 70,
      });
    });

    it('não classifica ciclos cancelados ou incertos como abandonados', async () => {
      const expected = [
        { ultima_etapa: 'catalog', ciclos_abandonados: 1 },
        { ultima_etapa: 'payment', ciclos_abandonados: 1 },
      ];
      const sorted = (rows: Row[]) =>
        [...rows].sort((a, b) => String(a.ultima_etapa).localeCompare(String(b.ultima_etapa)));
      const cancelled = cycle();
      const { base, aged } = await isolated(async tx => {
        await tx.insert(botEvents).values([
          event({
            name: 'purchase_started',
            cycleId: cancelled,
            reason: 'new',
            occurredAt: ago(60),
          }),
          event({
            name: 'turn',
            cycleId: cancelled,
            step: 'chooseQuantity',
            occurredAt: ago(50),
          }),
          event({ name: 'order_cancelled', cycleId: cancelled, occurredAt: ago(49) }),
        ]);
        const base = await query(tx, 'gestor-abandono.sql');
        await tx.execute(
          sql`UPDATE bot_events SET occurred_at = occurred_at - interval '3 days' WHERE cycle_id = ${pending}::uuid`,
        );
        return { base, aged: await query(tx, 'gestor-abandono.sql') };
      });
      expect(sorted(base)).toEqual(expected);
      expect(sorted(aged)).toEqual(expected);
    });

    it('retorna nulo ou zero quando não há denominador', async () => {
      const out = await isolated(
        async tx => ({
          conversao: (await query(tx, 'gestor-conversao.sql'))[0],
          vendas: (await query(tx, 'gestor-vendas.sql'))[0],
          abandono: await query(tx, 'gestor-abandono.sql'),
          espera: (await query(tx, 'supervisor-espera.sql'))[0],
        }),
        empty,
      );
      expect(out.conversao).toEqual({
        intencoes_maduras: 0,
        pedidos_em_intencoes_maduras: 0,
        conversao_madura_pct: 0,
        intencoes_totais: 0,
        pedidos_em_intencoes_totais: 0,
        conversao_total_pct: null,
      });
      expect(out.vendas).toEqual({
        pedidos_registrados: 0,
        valor_registrado_brl: 0,
        ticket_medio_brl: null,
        resultado_incerto: 0,
      });
      expect(out.abandono).toEqual([]);
      expect(out.espera).toEqual({
        espera_p50_seg: null,
        espera_p90_seg: null,
        handoffs_assumidos: 0,
      });
    });

    it('mede espera da fila até a assunção do handoff', async () => {
      const [row] = await isolated(tx => query(tx, 'supervisor-espera.sql'));
      expect(row).toEqual({ espera_p50_seg: 360, espera_p90_seg: 552, handoffs_assumidos: 2 });
    });

    it('não apresenta percentual de meta sem SLO aprovado', async () => {
      const [row] = await isolated(tx => query(tx, 'supervisor-espera.sql'));
      expect(Object.keys(row).sort()).toEqual([
        'espera_p50_seg',
        'espera_p90_seg',
        'handoffs_assumidos',
      ]);
      expect(code('supervisor-espera.sql')).not.toMatch(/meta|slo|sla|pct|percent(?!ile)|%/i);
    });

    type Failure = { cause?: { message?: string; code?: string } };

    async function failure(run: () => Promise<unknown>): Promise<Failure | undefined> {
      try {
        await run();
      } catch (error) {
        return error as Failure;
      }
    }

    const P0_FILES = [
      'gestor-vendas.sql',
      'gestor-conversao.sql',
      'gestor-abandono.sql',
      'supervisor-espera.sql',
    ];

    const P1_FILES = [
      'gestor-recompra.sql',
      'gestor-pico.sql',
      'gestor-mix.sql',
      'supervisor-expirados.sql',
      'tecnico-erp.sql',
      'tecnico-latencia-ia.sql',
      'supervisor-fila.sql',
      'supervisor-resolucao.sql',
    ];
    const CARD_FILES = [...P0_FILES, ...P1_FILES];

    it('aceita apenas períodos entre 1 e 365 dias', async () => {
      const guarded =
        /make_interval\(days => CASE WHEN \{\{dias\}\} BETWEEN 1 AND 365 THEN \{\{dias\}\} ELSE \('dias deve estar entre 1 e 365, recebido ' \|\| \{\{dias\}\}\)::int END\)/g;
      for (const file of CARD_FILES) {
        const uses = code(file).match(/\{\{dias\}\}/g) ?? [];
        const intervals = code(file).match(guarded) ?? [];
        expect(intervals.length).toBeGreaterThan(0);
        expect(code(file), file).toMatch(
          /is_simulated = false OR \{\{incluir_simulados\}\} = 'sim'/,
        );
        expect(uses).toHaveLength(intervals.length * 3);
        expect(code(file).match(/make_interval/g)).toHaveLength(intervals.length);
        expect(code(file)).not.toMatch(/\{\{dias\}\}\s*(day|days)\b|interval\s+'[^']*\{\{/i);
      }
      for (const days of [1, 30, 365]) expect(() => validDays(days)).not.toThrow();
      for (const days of [
        0,
        -1,
        366,
        1.5,
        Number.NaN,
        undefined,
        null,
        '30',
        '1; DROP TABLE bot_events',
      ]) {
        expect(() => validDays(days)).toThrow(RangeError);
      }
      const [row] = await isolated(tx => query(tx, 'supervisor-espera.sql', 1));
      expect(row?.handoffs_assumidos).toBe(0);
      await expect(isolated(tx => query(tx, 'supervisor-espera.sql', 366), empty)).rejects.toThrow(
        RangeError,
      );

      const forms = {
        vinculado: (file: string, days: number) => bound(file, days),
        literal: (file: string, days: number) => pasted(file, days),
      };
      for (const file of CARD_FILES) {
        for (const [form, build] of Object.entries(forms)) {
          await isolated(async tx => {
            for (const days of [1, 30, 365]) {
              await expect(
                tx.transaction(t => t.execute(build(file, days))),
                `${file} ${form} ${days}`,
              ).resolves.toBeDefined();
            }
            for (const days of [0, 366, -1, 10_000]) {
              const error = await failure(() => tx.transaction(t => t.execute(build(file, days))));
              expect(error, `${file} ${form} ${days}`).toBeDefined();
              expect(error?.cause?.message).toContain('dias deve estar entre 1 e 365');
            }
          }, empty);
        }
      }
    });

    it('não usa bot_events como fonte de vendas financeiras', async () => {
      expect(code('gestor-vendas.sql')).not.toMatch(/bot_events/i);
      expect(code('gestor-vendas.sql')).toMatch(/FROM\s+sale_attempts/i);
      for (const file of ['gestor-recompra.sql', 'gestor-mix.sql', 'tecnico-erp.sql']) {
        expect(code(file), file).not.toMatch(/bot_events/i);
        expect(code(file), file).toMatch(/FROM\s+sale_attempts/i);
      }
      const [row, mix, recompra] = await isolated(async tx => {
        await tx.insert(botEvents).values(
          Array.from({ length: 5 }, () =>
            event({
              name: 'sale',
              cycleId: cycle(),
              outcome: 'created',
              reason: 'direct',
              amount: 50_000,
              occurredAt: ago(1),
            }),
          ),
        );
        return [
          (await query(tx, 'gestor-vendas.sql'))[0],
          await query(tx, 'gestor-mix.sql'),
          (await query(tx, 'gestor-recompra.sql'))[0],
        ] as const;
      });
      expect(row).toMatchObject({ pedidos_registrados: 7, valor_registrado_brl: 980 });
      expect(mix.reduce((acc, line) => acc + Number(line.pedidos), 0)).toBe(7);
      expect(mix.reduce((acc, line) => acc + Number(line.valor_brl), 0)).toBe(980);
      expect(recompra).toMatchObject({ pedidos_recorrentes: 4, pedidos_novos: 3 });
    });

    it('inclui simulações somente quando o modo é pedido explicitamente', async () => {
      const simulatedAbandoned = cycle();
      const out = await isolated(async tx => {
        const run = async (mode: string) => ({
          vendas: (await query(tx, 'gestor-vendas.sql', 30, mode))[0],
          conversao: (await query(tx, 'gestor-conversao.sql', 30, mode))[0],
          abandono: await query(tx, 'gestor-abandono.sql', 30, mode),
          espera: (await query(tx, 'supervisor-espera.sql', 30, mode))[0],
        });
        const nao = await run('nao');
        const padrao = {
          vendas: (await query(tx, 'gestor-vendas.sql'))[0],
          espera: (await query(tx, 'supervisor-espera.sql'))[0],
        };
        const sim = await run('sim');
        const talvez = await run('talvez');
        const vazio = await run('');
        await tx.insert(botEvents).values([
          event({
            name: 'purchase_started',
            cycleId: simulatedAbandoned,
            reason: 'new',
            occurredAt: ago(60),
            isSimulated: true,
          }),
          event({
            name: 'turn',
            cycleId: simulatedAbandoned,
            step: 'review',
            occurredAt: ago(50),
            isSimulated: true,
          }),
        ]);
        return {
          nao,
          padrao,
          sim,
          talvez,
          vazio,
          abandonoNao: await query(tx, 'gestor-abandono.sql', 30, 'nao'),
          abandonoSim: await query(tx, 'gestor-abandono.sql', 30, 'sim'),
        };
      });
      const byStep = (rows: Row[]) =>
        Object.fromEntries(rows.map(row => [String(row.ultima_etapa), row.ciclos_abandonados]));

      expect(out.nao.vendas).toEqual({
        pedidos_registrados: 7,
        valor_registrado_brl: 980,
        ticket_medio_brl: 140,
        resultado_incerto: 1,
      });
      expect(out.padrao.vendas).toEqual(out.nao.vendas);
      expect(out.padrao.espera).toEqual(out.nao.espera);
      expect(out.nao.conversao).toMatchObject({
        intencoes_maduras: 9,
        pedidos_em_intencoes_maduras: 7,
        intencoes_totais: 10,
        pedidos_em_intencoes_totais: 7,
      });
      expect(byStep(out.nao.abandono)).toEqual({ catalog: 1, payment: 1 });
      expect(out.nao.espera).toEqual({
        espera_p50_seg: 360,
        espera_p90_seg: 552,
        handoffs_assumidos: 2,
      });

      expect(out.sim.vendas).toMatchObject({
        pedidos_registrados: 9,
        valor_registrado_brl: 2978,
        resultado_incerto: 2,
      });
      expect(out.sim.vendas.ticket_medio_brl).toBeCloseTo(2978 / 9, 6);
      expect(out.sim.conversao).toEqual({
        intencoes_maduras: 10,
        pedidos_em_intencoes_maduras: 8,
        conversao_madura_pct: 80,
        intencoes_totais: 11,
        pedidos_em_intencoes_totais: 8,
        conversao_total_pct: 72.7,
      });
      expect(byStep(out.sim.abandono)).toEqual({ catalog: 1, payment: 1 });
      expect(out.sim.espera).toEqual({
        espera_p50_seg: 600,
        espera_p90_seg: 3000,
        handoffs_assumidos: 3,
      });
      expect(byStep(out.abandonoNao)).toEqual({ catalog: 1, payment: 1 });
      expect(byStep(out.abandonoSim)).toEqual({ catalog: 1, payment: 1, review: 1 });

      expect(out.talvez).toEqual(out.nao);
      expect(out.vazio).toEqual(out.nao);
    });

    const CHART_FILES = [
      'gestor-funil-diario.sql',
      'tecnico-latencia.sql',
      'tecnico-ia.sql',
      'tecnico-rag.sql',
      'supervisor-handoffs.sql',
    ];

    async function seedCharts(tx: Tx) {
      const at = ago(30);
      const cycleA = cycle();
      const cycleB = cycle();
      const cycleC = cycle();
      await tx.insert(botEvents).values([
        event({ name: 'turn', cycleId: cycleA, step: 'catalog', durationMs: 100, occurredAt: at }),
        event({ name: 'turn', cycleId: cycleA, step: 'summary', durationMs: 300, occurredAt: at }),
        event({ name: 'sale', cycleId: cycleA, outcome: 'created', occurredAt: at }),
        event({ name: 'turn', cycleId: cycleB, step: 'catalog', durationMs: 200, occurredAt: at }),
        event({
          name: 'turn',
          cycleId: cycleC,
          step: 'catalog',
          durationMs: 1000,
          occurredAt: at,
          isSimulated: true,
        }),
        event({
          name: 'turn',
          cycleId: cycleC,
          step: 'summary',
          durationMs: 9000,
          occurredAt: at,
          isSimulated: true,
        }),
        event({
          name: 'sale',
          cycleId: cycleC,
          outcome: 'created',
          occurredAt: at,
          isSimulated: true,
        }),
        event({ name: 'turn', cycleId: cycle(), step: 'catalog', occurredAt: ago(24 * 400) }),
        event({
          name: 'ai_call',
          outcome: 'allowed',
          reason: 'interpret',
          amount: 3,
          occurredAt: at,
        }),
        event({
          name: 'ai_call',
          outcome: 'allowed',
          reason: 'interpret',
          amount: 4,
          occurredAt: at,
        }),
        event({ name: 'ai_call', outcome: 'limited', reason: 'interpret', occurredAt: at }),
        event({
          name: 'ai_call',
          outcome: 'allowed',
          reason: 'read_name',
          amount: 1,
          occurredAt: at,
        }),
        event({
          name: 'ai_call',
          outcome: 'allowed',
          reason: 'interpret',
          amount: 100,
          occurredAt: at,
          isSimulated: true,
        }),
        event({ name: 'rag', outcome: 'answered', occurredAt: at }),
        event({ name: 'rag', outcome: 'answered', occurredAt: at }),
        event({ name: 'rag', outcome: 'unknown', reason: 'low_score', occurredAt: at }),
        event({ name: 'rag', outcome: 'answered', occurredAt: at, isSimulated: true }),
        event({ name: 'handoff', outcome: 'queued', reason: 'customer_request', occurredAt: at }),
        event({ name: 'handoff', outcome: 'queued', reason: 'customer_request', occurredAt: at }),
        event({ name: 'handoff_offered', occurredAt: at }),
        event({
          name: 'handoff',
          outcome: 'queued',
          reason: 'customer_request',
          occurredAt: at,
          isSimulated: true,
        }),
        event({ name: 'handoff', reason: 'customer_request', occurredAt: ago(24 * 400) }),
      ]);
    }

    it('consultas dos gráficos excluem simulados com nao e incluem com sim', async () => {
      const out = await isolated(async tx => {
        const run = async (mode: string) => ({
          funil: await query(tx, 'gestor-funil-diario.sql', 30, mode),
          latencia: await query(tx, 'tecnico-latencia.sql', 30, mode),
          ia: await query(tx, 'tecnico-ia.sql', 30, mode),
          rag: await query(tx, 'tecnico-rag.sql', 30, mode),
          handoffs: await query(tx, 'supervisor-handoffs.sql', 30, mode),
        });
        return { nao: await run('nao'), sim: await run('sim'), talvez: await run('talvez') };
      }, seedCharts);
      const total = (rows: Row[], column: string) =>
        rows.reduce((acc, row) => acc + Number(row[column] ?? 0), 0);
      const by = (rows: Row[], key: string, column: string) =>
        Object.fromEntries(rows.map(row => [String(row[key]), row[column]]));

      expect(out.nao.funil).toHaveLength(1);
      expect(out.nao.funil[0]).toMatchObject({ ciclos: 2, resumos: 1, vendas: 1 });
      expect(out.sim.funil[0]).toMatchObject({ ciclos: 3, resumos: 2, vendas: 2 });
      expect(out.nao.latencia).toHaveLength(1);
      expect(out.nao.latencia[0].p50_ms).toBeCloseTo(200, 6);
      expect(out.nao.latencia[0].p95_ms).toBeCloseTo(290, 6);
      expect(out.sim.latencia).toHaveLength(1);
      expect(out.sim.latencia[0].p50_ms).toBeCloseTo(300, 6);
      expect(out.sim.latencia[0].p95_ms).toBeCloseTo(7400, 6);

      expect(by(out.nao.ia, 'reason', 'chamadas')).toEqual({ interpret: 3, read_name: 1 });
      expect(by(out.nao.ia, 'reason', 'unidades_consumidas')).toEqual({
        interpret: 7,
        read_name: 1,
      });
      expect(out.nao.ia.find(row => row.reason === 'interpret')).toMatchObject({
        permitidas: 2,
        bloqueadas: 1,
      });
      expect(by(out.sim.ia, 'reason', 'chamadas')).toEqual({ interpret: 4, read_name: 1 });
      expect(by(out.sim.ia, 'reason', 'unidades_consumidas')).toEqual({
        interpret: 107,
        read_name: 1,
      });

      expect(by(out.nao.rag, 'motivo', 'chamadas')).toEqual({ answered: 2, low_score: 1 });
      expect(by(out.sim.rag, 'motivo', 'chamadas')).toEqual({ answered: 3, low_score: 1 });
      expect(out.nao.rag.find(row => row.motivo === 'low_score')).toMatchObject({
        desconhecidas: 1,
        taxa_nao_sei_percentual: 100,
      });
      expect(total(out.nao.rag, 'chamadas')).toBe(3);
      expect(total(out.sim.rag, 'chamadas')).toBe(4);
      for (const mode of [out.nao, out.sim]) {
        expect(mode.rag.map(row => row.motivo)).not.toContain('total');
      }

      expect(out.nao.handoffs).toEqual([
        { motivo: 'customer_request', tipo: 'handoff', eventos: 2 },
        { motivo: 'sem_motivo', tipo: 'handoff_offered', eventos: 1 },
      ]);
      expect(out.sim.handoffs[0]).toEqual({
        motivo: 'customer_request',
        tipo: 'handoff',
        eventos: 3,
      });
      expect(out.talvez).toEqual(out.nao);
    });

    it('consultas dos gráficos validam dias e não expõem colunas pessoais', async () => {
      const guarded =
        /make_interval\(days => CASE WHEN \{\{dias\}\} BETWEEN 1 AND 365 THEN \{\{dias\}\} ELSE \('dias deve estar entre 1 e 365, recebido ' \|\| \{\{dias\}\}\)::int END\)/g;
      const allowed = [
        'dia',
        'ciclos',
        'resumos',
        'vendas',
        'conversao_percentual',
        'p50_ms',
        'p95_ms',
        'hora',
        'reason',
        'chamadas',
        'permitidas',
        'bloqueadas',
        'unidades_consumidas',
        'motivo',
        'desconhecidas',
        'taxa_nao_sei_percentual',
        'tipo',
        'eventos',
      ];
      const forbidden =
        /customer_id|erp_sale_id|conversation_id|handoff_id|phone|cpf|(customer|full|first|last)_?name|\bnome\b|address|endereco|\btext\b|select\s+\*|\.\*/i;
      for (const file of CHART_FILES) {
        const uses = code(file).match(/\{\{dias\}\}/g) ?? [];
        const intervals = code(file).match(guarded) ?? [];
        expect(intervals, file).toHaveLength(1);
        expect(uses, file).toHaveLength(3);
        expect(code(file), file).toMatch(
          /\(is_simulated = false OR \{\{incluir_simulados\}\} = 'sim'\)/,
        );
        expect(code(file), file).not.toMatch(forbidden);
      }
      const columns = await isolated(async tx => {
        const found = new Set<string>();
        for (const file of CHART_FILES) {
          const { fields } = await tx.execute(bound(file, 30));
          for (const field of fields) found.add(field.name);
          for (const days of [0, 366]) {
            const error = await failure(() => tx.transaction(t => t.execute(bound(file, days))));
            expect(error?.cause?.message, `${file} ${days}`).toContain(
              'dias deve estar entre 1 e 365',
            );
          }
        }
        return [...found];
      }, empty);
      for (const column of columns) expect(allowed).toContain(column);
    });

    it('não seleciona colunas de identificação pessoal', async () => {
      const allowed = [
        'pedidos_registrados',
        'valor_registrado_brl',
        'ticket_medio_brl',
        'resultado_incerto',
        'intencoes_maduras',
        'pedidos_em_intencoes_maduras',
        'conversao_madura_pct',
        'intencoes_totais',
        'pedidos_em_intencoes_totais',
        'conversao_total_pct',
        'ultima_etapa',
        'ciclos_abandonados',
        'espera_p50_seg',
        'espera_p90_seg',
        'handoffs_assumidos',
        'pedidos_recorrentes',
        'pedidos_novos',
        'pedidos_sem_segmento',
        'recompra_pct',
        'hora_utc',
        'intencoes',
        'product_code',
        'payment_method_code',
        'pedidos',
        'valor_brl',
        'motivo',
        'expirados',
        'pedidos_transferidos',
        'duracao_expiracao_p50_seg',
        'status',
        'error_kind',
        'tentativas',
        'dia_utc',
        'turno_p50_ms',
        'turno_p90_ms',
        'chamadas_ia',
        'chamadas_limitadas',
        'snapshot_em_utc',
        'fila_pendente',
        'categoria',
        'ciclos',
        'percentual',
      ];
      const forbidden =
        /customer_id|erp_sale_id|conversation_id|handoff_id|phone|cpf|(customer|full|first|last)_?name|\bnome\b|address|endereco|\btext\b|select\s+\*|\.\*/i;
      const returned = await isolated(async tx => {
        const columns = new Set<string>();
        for (const file of CARD_FILES) {
          const { fields } = await tx.execute(bound(file, 30));
          for (const field of fields) columns.add(field.name);
        }
        return [...columns];
      });
      expect(returned.length).toBeGreaterThan(0);
      for (const column of returned) expect(allowed).toContain(column);
      for (const file of CARD_FILES) {
        const text =
          file === 'supervisor-expirados.sql'
            ? code(file).replaceAll('handoff_id', '')
            : code(file);
        expect(text, file).not.toMatch(forbidden);
      }
    });

    const modes = async (tx: Tx, file: string) => ({
      nao: await query(tx, file, 30, 'nao'),
      sim: await query(tx, file, 30, 'sim'),
      talvez: await query(tx, file, 30, 'talvez'),
    });

    it('calcula recompra de 4 em 7 pedidos com desconhecidos fora do denominador', async () => {
      const out = await isolated(async tx => {
        const base = await modes(tx, 'gestor-recompra.sql');
        await tx
          .insert(saleAttempts)
          .values([
            attempt({ cycleId: cycle(), status: 'registered' }),
            attempt({ cycleId: cycle(), status: 'registered' }),
          ]);
        return { base, comDesconhecidos: (await query(tx, 'gestor-recompra.sql'))[0] };
      });
      expect(out.base.nao).toEqual([
        { pedidos_recorrentes: 4, pedidos_novos: 3, pedidos_sem_segmento: 0, recompra_pct: 57.1 },
      ]);
      expect(out.base.sim[0]).toEqual({
        pedidos_recorrentes: 4,
        pedidos_novos: 3,
        pedidos_sem_segmento: 2,
        recompra_pct: 57.1,
      });
      expect(out.base.talvez).toEqual(out.base.nao);
      expect(out.comDesconhecidos).toEqual({
        pedidos_recorrentes: 4,
        pedidos_novos: 3,
        pedidos_sem_segmento: 2,
        recompra_pct: 57.1,
      });
    });

    it('retorna nulo na recompra quando não há clientes classificados', async () => {
      const semDados = await isolated(
        async tx => (await query(tx, 'gestor-recompra.sql'))[0],
        empty,
      );
      const soDesconhecidos = await isolated(
        async tx => (await query(tx, 'gestor-recompra.sql'))[0],
        async tx => {
          await tx
            .insert(saleAttempts)
            .values([
              attempt({ cycleId: cycle(), status: 'registered' }),
              attempt({ cycleId: cycle(), status: 'registered' }),
            ]);
        },
      );
      expect(semDados).toEqual({
        pedidos_recorrentes: 0,
        pedidos_novos: 0,
        pedidos_sem_segmento: 0,
        recompra_pct: null,
      });
      expect(soDesconhecidos).toEqual({
        pedidos_recorrentes: 0,
        pedidos_novos: 0,
        pedidos_sem_segmento: 2,
        recompra_pct: null,
      });
    });

    it('cruza produto e pagamento e fecha as margens do mix', async () => {
      const out = await isolated(tx => modes(tx, 'gestor-mix.sql'));
      expect(out.nao).toEqual([
        { product_code: 'P13', payment_method_code: 'PIX', pedidos: 3, valor_brl: 420 },
        { product_code: 'P45', payment_method_code: 'PIX', pedidos: 2, valor_brl: 280 },
        { product_code: 'P13', payment_method_code: 'DINHEIRO', pedidos: 1, valor_brl: 140 },
        { product_code: 'P45', payment_method_code: 'DINHEIRO', pedidos: 1, valor_brl: 140 },
      ]);
      const total = (rows: Row[], key: string, value: string, column: string) =>
        rows.filter(row => row[key] === value).reduce((acc, row) => acc + Number(row[column]), 0);
      expect(total(out.nao, 'product_code', 'P13', 'pedidos')).toBe(4);
      expect(total(out.nao, 'product_code', 'P13', 'valor_brl')).toBe(560);
      expect(total(out.nao, 'product_code', 'P45', 'pedidos')).toBe(3);
      expect(total(out.nao, 'product_code', 'P45', 'valor_brl')).toBe(420);
      expect(total(out.nao, 'payment_method_code', 'PIX', 'pedidos')).toBe(5);
      expect(total(out.nao, 'payment_method_code', 'PIX', 'valor_brl')).toBe(700);
      expect(total(out.nao, 'payment_method_code', 'DINHEIRO', 'pedidos')).toBe(2);
      expect(total(out.nao, 'payment_method_code', 'DINHEIRO', 'valor_brl')).toBe(280);
      expect(total(out.sim, 'payment_method_code', 'PIX', 'pedidos')).toBe(7);
      expect(out.talvez).toEqual(out.nao);
    });

    it('agrupa intenções de compra por hora UTC', async () => {
      const out = await isolated(async tx => {
        await tx.execute(
          sql`UPDATE bot_events
              SET occurred_at = (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '3 days' + interval '22 hours') AT TIME ZONE 'UTC'
              WHERE name = 'purchase_started' AND cycle_id = ${pending}::uuid`,
        );
        return modes(tx, 'gestor-pico.sql');
      });
      expect(out.nao).toEqual([
        { hora_utc: 10, intencoes: 2 },
        { hora_utc: 14, intencoes: 4 },
        { hora_utc: 18, intencoes: 3 },
        { hora_utc: 22, intencoes: 1 },
      ]);
      expect(out.sim.reduce((acc, row) => acc + Number(row.intencoes), 0)).toBe(11);
      expect(out.talvez).toEqual(out.nao);
    });

    it('conta expirações únicas e mede a mediana só das expiradas', async () => {
      const [first, second, third, fourth, simulated] = Array.from({ length: 5 }, cycle);
      const [expiredA, expiredB, expiredSim] = [randomUUID(), randomUUID(), randomUUID()];
      const out = await isolated(async tx => {
        await tx.insert(botEvents).values([
          event({
            name: 'handoff',
            cycleId: first,
            reason: 'customer_request',
            occurredAt: ago(30),
          }),
          event({
            name: 'handoff',
            cycleId: second,
            reason: 'customer_request',
            occurredAt: ago(30),
          }),
          event({
            name: 'handoff',
            cycleId: third,
            reason: 'customer_request',
            occurredAt: ago(30),
          }),
          event({
            name: 'handoff',
            cycleId: fourth,
            reason: 'customer_request',
            occurredAt: ago(30),
          }),
          event({
            name: 'handoff_expired',
            cycleId: third,
            handoffId: expiredA,
            durationMs: 900_000,
            occurredAt: ago(29),
          }),
          event({
            name: 'handoff_expired',
            cycleId: third,
            handoffId: expiredA,
            durationMs: 900_000,
            occurredAt: ago(29),
          }),
          event({
            name: 'handoff_expired',
            cycleId: fourth,
            handoffId: expiredB,
            durationMs: 1_800_000,
            occurredAt: ago(29),
          }),
          event({
            name: 'handoff',
            cycleId: simulated,
            reason: 'customer_request',
            occurredAt: ago(30),
            isSimulated: true,
          }),
          event({
            name: 'handoff_expired',
            cycleId: simulated,
            handoffId: expiredSim,
            durationMs: 7_200_000,
            occurredAt: ago(29),
            isSimulated: true,
          }),
        ]);
        return modes(tx, 'supervisor-expirados.sql');
      });
      const linha = (rows: Row[]) => rows.find(row => row.motivo === 'customer_request');
      expect(out.nao).toHaveLength(1);
      expect(linha(out.nao)).toEqual({
        motivo: 'customer_request',
        expirados: 2,
        pedidos_transferidos: 6,
        duracao_expiracao_p50_seg: 1350,
      });
      expect(linha(out.sim)).toEqual({
        motivo: 'customer_request',
        expirados: 3,
        pedidos_transferidos: 7,
        duracao_expiracao_p50_seg: 1800,
      });
      expect(out.talvez).toEqual(out.nao);
    });

    it('conta tentativas incertas por categoria de erro', async () => {
      const out = await isolated(tx => modes(tx, 'tecnico-erp.sql'));
      expect(out.nao).toEqual([
        { status: 'rejected', error_kind: null, tentativas: 1 },
        { status: 'uncertain', error_kind: 'timeout', tentativas: 1 },
      ]);
      expect(out.sim).toEqual([
        { status: 'rejected', error_kind: null, tentativas: 1 },
        { status: 'uncertain', error_kind: 'timeout', tentativas: 1 },
        { status: 'uncertain', error_kind: null, tentativas: 1 },
      ]);
      expect(out.talvez).toEqual(out.nao);
    });

    it('mede 10 turnos de 400 ms e 4 chamadas de IA com 1 limitada', async () => {
      const out = await isolated(async tx => ({
        turnos: (
          await tx.execute(
            sql`SELECT count(*) AS n FROM bot_events
                WHERE name = 'turn' AND is_simulated = false AND duration_ms = 400`,
          )
        ).rows[0]?.n,
        ...(await modes(tx, 'tecnico-latencia-ia.sql')),
      }));
      expect(Number(out.turnos)).toBe(10);
      const sum = (rows: Row[], column: string) =>
        rows.reduce((acc, row) => acc + Number(row[column]), 0);
      const withTurns = out.nao.filter(row => row.turno_p50_ms !== null);
      expect(withTurns.length).toBeGreaterThan(0);
      for (const row of withTurns) {
        expect(row.turno_p50_ms).toBe(400);
        expect(row.turno_p90_ms).toBe(400);
      }
      expect(sum(out.nao, 'chamadas_ia')).toBe(4);
      expect(sum(out.nao, 'chamadas_limitadas')).toBe(1);
      expect(sum(out.sim, 'chamadas_ia')).toBe(5);
      expect(sum(out.sim, 'chamadas_limitadas')).toBe(2);
      expect(out.talvez).toEqual(out.nao);
    });

    it('usa o snapshot mais recente como fila atual', async () => {
      const latest = ago(1);
      const out = await isolated(async tx => {
        await tx.insert(botEvents).values([
          event({ name: 'handoff_queue_snapshot', amount: 3, occurredAt: ago(5) }),
          event({ name: 'handoff_queue_snapshot', amount: 2, occurredAt: ago(3) }),
          event({ name: 'handoff_queue_snapshot', amount: 1, occurredAt: latest }),
          event({
            name: 'handoff_queue_snapshot',
            amount: 9,
            occurredAt: ago(0.5),
            isSimulated: true,
          }),
          event({ name: 'handoff_queue_snapshot', amount: 7, occurredAt: ago(24 * 400) }),
        ]);
        return {
          ...(await modes(tx, 'supervisor-fila.sql')),
          umDia: await query(tx, 'supervisor-fila.sql', 1, 'nao'),
        };
      });
      expect(out.nao).toHaveLength(1);
      expect(out.nao[0]?.fila_pendente).toBe(1);
      const instante = new Date(out.nao[0]?.snapshot_em_utc as string).getTime();
      expect(Math.abs(instante - latest.getTime())).toBeLessThan(1000);
      expect(out.sim[0]?.fila_pendente).toBe(9);
      expect(out.talvez).toEqual(out.nao);
      expect(out.umDia[0]?.fila_pendente).toBe(1);
      expect(await isolated(tx => query(tx, 'supervisor-fila.sql'), empty)).toEqual([]);
    });

    it('classifica 5 ciclos automáticos, 2 humanos, 2 abandonados e 1 pendente', async () => {
      const simulated = cycle();
      const out = await isolated(async tx => {
        const semEncerramento = await query(tx, 'supervisor-resolucao.sql');
        await tx.insert(botEvents).values([
          ...[...automatic, ...human].map(cycleId =>
            event({
              name: 'conversation_resolved',
              cycleId,
              outcome: 'registered',
              occurredAt: ago(24),
            }),
          ),
          event({
            name: 'ai_call',
            cycleId: pending,
            outcome: 'allowed',
            reason: 'interpret',
            amount: 1,
            occurredAt: ago(1),
          }),
          event({
            name: 'purchase_started',
            cycleId: simulated,
            reason: 'new',
            occurredAt: ago(60),
            isSimulated: true,
          }),
        ]);
        return { semEncerramento, ...(await modes(tx, 'supervisor-resolucao.sql')) };
      });
      expect(out.semEncerramento).toEqual([
        { categoria: 'abandonada', ciclos: 2, percentual: 100 },
        { categoria: 'pendente', ciclos: 8, percentual: null },
      ]);
      expect(out.nao).toEqual([
        { categoria: 'abandonada', ciclos: 2, percentual: 22.2 },
        { categoria: 'automatica', ciclos: 5, percentual: 55.6 },
        { categoria: 'mista', ciclos: 2, percentual: 22.2 },
        { categoria: 'pendente', ciclos: 1, percentual: null },
      ]);
      expect(out.sim.find(row => row.categoria === 'abandonada')?.ciclos).toBe(3);
      expect(out.talvez).toEqual(out.nao);
    });

    it('ciclo real de venda alimenta supervisor-resolucao sem fixture do evento', async () => {
      const cycleId = cycles[0] as string;
      const real = await vi.waitFor(async () => {
        const rows = await db.select().from(botEvents).where(eq(botEvents.cycleId, cycleId));
        expect(rows.filter(row => row.name === 'conversation_resolved')).toHaveLength(1);
        return rows;
      });
      const attempts = await db
        .select()
        .from(saleAttempts)
        .where(eq(saleAttempts.cycleId, cycleId));
      expect(real.find(row => row.name === 'conversation_resolved')?.outcome).toBe('registered');
      const out = await isolated(
        async tx => {
          await tx.insert(botEvents).values(real.map(({ id: _id, ...row }) => row));
          if (attempts.length)
            await tx.insert(saleAttempts).values(attempts.map(({ id: _id, ...row }) => row));
          return query(tx, 'supervisor-resolucao.sql', 30, 'sim');
        },
        async () => undefined,
      );
      expect(out).toEqual([{ categoria: 'automatica', ciclos: 1, percentual: 100 }]);
    });

    it('snapshot real da fila alimenta supervisor-fila', async () => {
      const handoffs = app.get(HandoffRepository);
      const scheduler = app.get(QueueSnapshotScheduler);
      const queuedPhone = `55869${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
      const started = new Date();
      await handoffs.saveState(queuedPhone, {
        status: 'queued',
        conversationId: 1,
        reason: 'customer_request',
        since: new Date(started.getTime() - 600_000).toISOString(),
        requestedAt: new Date(started.getTime() - 600_000).toISOString(),
      });
      await redis.del(`${QUEUE_SNAPSHOT_PREFIX}:tick`);
      try {
        await scheduler.tick();
        const [snapshot] = await vi.waitFor(async () => {
          const rows = await db
            .select()
            .from(botEvents)
            .where(eq(botEvents.name, 'handoff_queue_snapshot'))
            .orderBy(desc(botEvents.occurredAt), desc(botEvents.id))
            .limit(1);
          expect(rows[0]?.occurredAt.getTime()).toBeGreaterThanOrEqual(started.getTime() - 1000);
          return rows;
        });
        expect(snapshot?.amount).toBeGreaterThanOrEqual(1);
        expect(snapshot?.durationMs).toBeGreaterThanOrEqual(600_000);
        const out = await isolated(
          async tx => {
            const { id: _id, ...row } = snapshot as NonNullable<typeof snapshot>;
            await tx.insert(botEvents).values(row);
            return query(tx, 'supervisor-fila.sql', 30, 'sim');
          },
          async () => undefined,
        );
        expect(out).toHaveLength(1);
        expect(out[0]?.fila_pendente).toBe(snapshot?.amount);
        await db.delete(botEvents).where(eq(botEvents.id, (snapshot as { id: bigint }).id));
      } finally {
        await handoffs.clearState(queuedPhone);
        await redis.del(`${QUEUE_SNAPSHOT_PREFIX}:tick`);
      }
    });

    it('papel restrito lê os quatro cards e não lê identificadores operacionais', async () => {
      const role = `mr_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const grants = readFileSync(
        resolve(process.cwd(), 'docker/metabase/metrics-reader.sql'),
        'utf8',
      )
        .split('\n')
        .filter(line => /^GRANT\b/i.test(line) && !/^GRANT\s+CONNECT\b/i.test(line))
        .map(line => line.replaceAll('metrics_reader', role));
      expect(grants.length).toBeGreaterThanOrEqual(3);

      const denied = (tx: Tx, statement: string) =>
        failure(() => tx.transaction(t => t.execute(sql.raw(statement))));

      const out = await (async () => {
        let result:
          | { errors: (Failure | undefined)[]; readable: unknown[]; writable: unknown[] }
          | undefined;
        try {
          await db.transaction(async tx => {
            await tx.execute(sql.raw(`CREATE ROLE ${role} NOLOGIN`));
            for (const grant of grants) await tx.execute(sql.raw(grant));
            await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`));
            for (const file of [...CARD_FILES, ...CHART_FILES]) {
              await tx.execute(bound(file, 30));
            }
            const errors = [
              await denied(tx, 'SELECT customer_id FROM sale_attempts'),
              await denied(tx, 'SELECT erp_sale_id FROM sale_attempts'),
              await denied(tx, 'SELECT * FROM sale_attempts'),
            ];
            const readable = (
              await tx.execute(
                sql`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
                      AND c.relname NOT IN ('bot_events', 'sale_attempts')
                      AND (has_table_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                        OR has_any_column_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))`,
              )
            ).rows;
            const writable = (
              await tx.execute(
                sql`SELECT c.relname FROM pg_class c
                    WHERE c.relname IN ('bot_events', 'sale_attempts') AND c.relnamespace = 'public'::regnamespace
                      AND (has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                        OR has_any_column_privilege(current_user, c.oid, 'INSERT,UPDATE,REFERENCES')
                        OR (c.relname = 'sale_attempts' AND has_table_privilege(current_user, c.oid, 'SELECT')))`,
              )
            ).rows;
            result = { errors, readable, writable };
            throw ROLLBACK;
          });
        } catch (error) {
          if (error !== ROLLBACK) throw error;
        }
        return result;
      })();

      expect(out?.errors).toHaveLength(3);
      for (const error of out?.errors ?? []) {
        expect(error?.cause?.code).toBe('42501');
      }
      expect(out?.readable).toEqual([]);
      expect(out?.writable).toEqual([]);
      const left = await db.execute(sql`SELECT 1 FROM pg_roles WHERE rolname = ${role}`);
      expect(left.rows).toHaveLength(0);
    });
  });
});
