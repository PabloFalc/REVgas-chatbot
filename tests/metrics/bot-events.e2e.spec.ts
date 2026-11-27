import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { REDIS } from 'src/infra/cache/redis.client';
import { DRIZZLE } from 'src/infra/database/drizzle-client';
import type * as schema from 'src/infra/database/schemas';
import { botEvents } from 'src/infra/database/schemas';
import { FAKE_CUSTOMERS } from 'src/integrations/revgas/customers/customers.fixtures';
import type { FakeRevgasClient } from 'src/integrations/revgas/fake-revgas.client';
import { REVGAS_CLIENT } from 'src/integrations/revgas/revgas.client';
import type { FakeWhatsappClient } from 'src/integrations/whatsapp/fake-whatsapp.client';
import { textWebhook, webhookPayload } from 'src/integrations/whatsapp/testing/webhook.testing';
import { signPayload } from 'src/integrations/whatsapp/webhook/signature';
import { WHATSAPP_CLIENT } from 'src/integrations/whatsapp/whatsapp.client';
import {
  ConversationRepository,
  INBOUND_PREFIX,
  ORDER_PREFIX,
  REMINDER_SET,
  VERIFIED_PREFIX,
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
    await redis.del(`${ORDER_PREFIX}:${phone}`, ...ids.map(id => `${INBOUND_PREFIX}:${id}`));
    const verified = await redis.keys(`${VERIFIED_PREFIX}:${phone}:*`);
    if (verified.length) await redis.del(...verified);
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
            'prevStep',
            'step',
            'outcome',
            'reason',
            'durationMs',
            'amount',
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
});
