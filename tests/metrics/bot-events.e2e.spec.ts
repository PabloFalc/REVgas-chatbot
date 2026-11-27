import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, inArray, sql } from 'drizzle-orm';
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
      ['000', false],
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
    type Row = Record<string, number | null>;

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
      for (const cycleId of registered) {
        events.push(
          event({ name: 'purchase_started', cycleId, reason: 'new', occurredAt: ago(72) }),
          event({ name: 'turn', cycleId, step: 'summary', occurredAt: ago(71) }),
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
          event({ name: 'purchase_started', cycleId, reason: 'unknown', occurredAt: ago(60) }),
          event({
            name: 'turn',
            cycleId,
            prevStep: 'chooseAddress',
            step: index === 0 ? 'catalog' : 'payment',
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
        event({ name: 'turn', cycleId: pending, step: 'summary', occurredAt: ago(1.5) }),
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
        attempt({ cycleId: pending, status: 'uncertain', createdAt: ago(1) }),
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

    it('retorna nulo quando não há denominador', async () => {
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
        conversao_madura_pct: null,
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

    it('aceita apenas períodos entre 1 e 365 dias', async () => {
      const guarded =
        /make_interval\(days => CASE WHEN \{\{dias\}\} BETWEEN 1 AND 365 THEN \{\{dias\}\} ELSE \('dias deve estar entre 1 e 365, recebido ' \|\| \{\{dias\}\}\)::int END\)/g;
      for (const file of P0_FILES) {
        const uses = code(file).match(/\{\{dias\}\}/g) ?? [];
        const intervals = code(file).match(guarded) ?? [];
        expect(intervals.length).toBeGreaterThan(0);
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
      for (const file of P0_FILES) {
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
      const [row] = await isolated(async tx => {
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
        return query(tx, 'gestor-vendas.sql');
      });
      expect(row).toMatchObject({ pedidos_registrados: 7, valor_registrado_brl: 980 });
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
      ];
      const forbidden =
        /customer_id|erp_sale_id|conversation_id|handoff_id|phone|cpf|(customer|full|first|last)_?name|\bnome\b|address|endereco|\btext\b|select\s+\*|\.\*/i;
      const returned = await isolated(async tx => {
        const columns = new Set<string>();
        for (const file of P0_FILES) {
          const { fields } = await tx.execute(bound(file, 30));
          for (const field of fields) columns.add(field.name);
        }
        return [...columns];
      });
      expect(returned.length).toBeGreaterThan(0);
      for (const column of returned) expect(allowed).toContain(column);
      for (const file of P0_FILES) expect(code(file)).not.toMatch(forbidden);
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
            for (const file of P0_FILES) {
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
