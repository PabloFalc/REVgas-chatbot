import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { REDIS } from 'src/infra/cache/redis.client';
import { RedisService } from 'src/infra/cache/redis.service';
import { DRIZZLE } from 'src/infra/database/drizzle-client';
import type * as schema from 'src/infra/database/schemas';
import { saleAttempts } from 'src/infra/database/schemas';
import { FAKE_CUSTOMERS } from 'src/integrations/revgas/customers/customers.fixtures';
import { FakeRevgasClient } from 'src/integrations/revgas/fake-revgas.client';
import { REVGAS_CLIENT } from 'src/integrations/revgas/revgas.client';
import { FakeWhatsappClient } from 'src/integrations/whatsapp/fake-whatsapp.client';
import { textWebhook } from 'src/integrations/whatsapp/testing/webhook.testing';
import { signPayload } from 'src/integrations/whatsapp/webhook/signature';
import { WHATSAPP_CLIENT } from 'src/integrations/whatsapp/whatsapp.client';
import {
  ConversationRepository,
  IDENTITY_PREFIX,
  INBOUND_PREFIX,
  LOCK_PREFIX,
  ORDER_PREFIX,
  REMINDER_SET,
} from 'src/modules/conversation/conversation.repository';
import { msg } from 'src/modules/conversation/flow/messages';
import supertest from 'supertest';
import { createApp } from '../setup-e2e';

const SECRET = 'e2e-whatsapp-app-secret-0123456789';
const PATH = '/webhooks/whatsapp';
const PHONE = '5586900000001';
const SEQUENTIAL_PHONE = '5586900000002';

describe('Concorrência de venda e scripts Redis (e2e)', () => {
  let app: NestFastifyApplication;
  let request: ReturnType<typeof supertest>;
  let whatsapp: FakeWhatsappClient;
  let revgas: FakeRevgasClient;
  let repository: ConversationRepository;
  let cache: RedisService;
  let redis: Redis;
  let db: NodePgDatabase<typeof schema>;
  const inboundIds: string[] = [];
  const phones = [PHONE, SEQUENTIAL_PHONE];
  const cacheKeys: string[] = [];
  const scheduleMembers: string[] = [];
  const cycles: string[] = [];

  const newPhone = () => {
    const phone = `55869${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    phones.push(phone);
    return phone;
  };

  const newId = () => {
    const id = `wamid.e2e.${randomUUID()}`;
    inboundIds.push(id);
    return id;
  };

  const post = (text: string, phone: string, id = newId()) => {
    const raw = JSON.stringify(textWebhook(text, id, phone));
    return request
      .post(PATH)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signPayload(raw, SECRET))
      .send(raw)
      .expect(200);
  };

  const postChoice = (choiceId: string, phone: string, id = newId()) => {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_ID',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '5586000000000', phone_number_id: '1122334455' },
                contacts: [{ profile: { name: 'Cliente Teste' }, wa_id: phone }],
                messages: [
                  {
                    from: phone,
                    id,
                    timestamp: '1760000000',
                    type: 'interactive',
                    interactive: {
                      type: 'list_reply',
                      list_reply: { id: choiceId, title: choiceId },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    return request
      .post(PATH)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signPayload(raw, SECRET))
      .send(raw)
      .expect(200);
  };

  const sentBodies = () => whatsapp.sent.map(sent => JSON.stringify(sent.body)).join(' ');

  const clearPhoneState = async () => {
    await redis.del(
      ...phones.flatMap(phone => [
        `${ORDER_PREFIX}:${phone}`,
        `${LOCK_PREFIX}:${phone}`,
        `${IDENTITY_PREFIX}:${phone}`,
      ]),
    );
  };

  const sendUntilSummary = async (phone: string) => {
    await post('oi', phone);
    await vi.waitFor(() => expect(whatsapp.sent.length).toBeGreaterThan(0));
    whatsapp.clear();
    const cpf = FAKE_CUSTOMERS.find(customer => customer.phones?.includes(phone))?.cpf ?? '';
    await post(cpf, phone);
    await vi.waitFor(() => expect(sentBodies()).toContain('address:0'));
    whatsapp.clear();
    await postChoice('address:0', phone);
    await vi.waitFor(() => expect(whatsapp.sent.length).toBeGreaterThan(0));
    whatsapp.clear();
    await postChoice('product:900000101', phone);
    await vi.waitFor(() => expect(whatsapp.sent.length).toBeGreaterThan(0));
    whatsapp.clear();
    await postChoice('qty:1', phone);
    await vi.waitFor(() => expect(whatsapp.sent.length).toBeGreaterThan(0));
    whatsapp.clear();
    await postChoice('pay:PIX', phone);
    await vi.waitFor(() => expect(sentBodies()).toContain(msg.confirm));
  };

  beforeAll(async () => {
    app = await createApp();
    request = supertest(app.getHttpServer());
    whatsapp = app.get(WHATSAPP_CLIENT);
    revgas = app.get(REVGAS_CLIENT);
    repository = app.get(ConversationRepository);
    cache = app.get(RedisService);
    redis = app.get(REDIS);
    db = app.get(DRIZZLE);
    await clearPhoneState();
  }, 30000);

  beforeEach(() => {
    whatsapp.clear();
  });

  afterAll(async () => {
    if (inboundIds.length > 0) {
      await redis.del(...inboundIds.map(id => `${INBOUND_PREFIX}:${id}`));
    }
    await clearPhoneState();
    if (cacheKeys.length > 0) await redis.del(...cacheKeys);
    if (scheduleMembers.length > 0) await redis.zrem(REMINDER_SET, ...scheduleMembers);
    if (cycles.length > 0)
      await db.delete(saleAttempts).where(inArray(saleAttempts.cycleId, cycles));
    await app.close();
  }, 30000);

  it('usa o fake RevGás e o fake WhatsApp', () => {
    expect(revgas).toBeInstanceOf(FakeRevgasClient);
    expect(whatsapp).toBeInstanceOf(FakeWhatsappClient);
  });

  it('confirma duas mensagens concorrentes como uma única venda e envia um número', async () => {
    await sendUntilSummary(PHONE);
    const cycleId = (await repository.loadOrder(PHONE))?.cycleId;
    if (!cycleId) throw new Error('Pedido sem ciclo');
    cycles.push(cycleId);
    const saleCount = (await revgas.sales.list()).pagination.total_count;
    await Promise.all([
      postChoice('summary:confirm:1', PHONE),
      postChoice('summary:confirm:1', PHONE),
    ]);

    await vi.waitFor(async () =>
      expect((await revgas.sales.list()).pagination.total_count).toBe(saleCount + 1),
    );
    const sale = (await revgas.sales.list()).data[0];
    const total = sale.total;
    if (total === null || total === undefined) throw new Error('Venda sem total');
    await vi.waitFor(() =>
      expect(
        whatsapp.sent.filter(sent =>
          JSON.stringify(sent.body).includes(msg.demoSaleCreated(sale.id, total)),
        ),
      ).toHaveLength(1),
    );
    const attempts = await db
      .select({ status: saleAttempts.status, erpSaleId: saleAttempts.erpSaleId })
      .from(saleAttempts)
      .where(eq(saleAttempts.cycleId, cycleId));
    expect(attempts).toEqual([{ status: 'registered', erpSaleId: sale.id }]);
  });

  it('uma confirmação posterior à venda não cria outra venda', async () => {
    await sendUntilSummary(SEQUENTIAL_PHONE);
    const saleCount = (await revgas.sales.list()).pagination.total_count;
    await postChoice('summary:confirm:1', SEQUENTIAL_PHONE);
    await vi.waitFor(async () =>
      expect((await revgas.sales.list()).pagination.total_count).toBe(saleCount + 1),
    );
    const afterSale = (await revgas.sales.list()).pagination.total_count;
    const sale = (await revgas.sales.list()).data[0];
    const total = sale.total;
    if (total === null || total === undefined) throw new Error('Venda sem total');
    await vi.waitFor(() =>
      expect(
        whatsapp.sent.filter(sent =>
          JSON.stringify(sent.body).includes(msg.demoSaleCreated(sale.id, total)),
        ),
      ).toHaveLength(1),
    );
    whatsapp.clear();
    await postChoice('summary:confirm:1', SEQUENTIAL_PHONE);

    await vi.waitFor(() => expect(whatsapp.sent.length).toBeGreaterThan(0));
    expect((await revgas.sales.list()).pagination.total_count).toBe(afterSale);
  });

  it('claimReminder concorrente concede a reserva para apenas um chamador', async () => {
    const phone = newPhone();
    const dueAt = Date.now() - 60_000;
    scheduleMembers.push(phone);
    await repository.scheduleReminder(phone, new Date(dueAt));

    const claims = await Promise.all([
      repository.claimReminder(phone, dueAt),
      repository.claimReminder(phone, dueAt),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('deleteIfEquals remove a chave somente quando o token corresponde', async () => {
    const prefix = 'e2e';
    const key = `delete-if-equals:${randomUUID()}`;
    cacheKeys.push(`${prefix}:${key}`);
    await redis.set(`${prefix}:${key}`, JSON.stringify('token-atual'));

    await expect(cache.deleteIfEquals({ prefix, key, value: 'token-anterior' })).resolves.toBe(
      false,
    );
    await expect(redis.get(`${prefix}:${key}`)).resolves.toBe(JSON.stringify('token-atual'));
    await expect(cache.deleteIfEquals({ prefix, key, value: 'token-atual' })).resolves.toBe(true);
    await expect(redis.get(`${prefix}:${key}`)).resolves.toBeNull();
  });
});
