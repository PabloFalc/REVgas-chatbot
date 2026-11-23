import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type Redis from 'ioredis';
import { REDIS } from 'src/infra/cache/redis.client';
import type { FakeWhatsappClient } from 'src/integrations/whatsapp/fake-whatsapp.client';
import { textWebhook } from 'src/integrations/whatsapp/testing/webhook.testing';
import { signPayload } from 'src/integrations/whatsapp/webhook/signature';
import { WHATSAPP_CLIENT } from 'src/integrations/whatsapp/whatsapp.client';
import {
  INBOUND_PREFIX,
  LOCK_PREFIX,
  ORDER_PREFIX,
} from 'src/modules/conversation/conversation.repository';
import supertest from 'supertest';
import { createApp } from '../setup-e2e';

const ALLOWED = vi.hoisted(() => {
  const phone = '5586999995555';
  process.env.WHATSAPP_ALLOWED_SENDERS = phone;
  return phone;
});

const SECRET = 'e2e-whatsapp-app-secret-0123456789';
const PATH = '/webhooks/whatsapp';
const STRANGER = '5586988884444';

describe('Allowlist do webhook do WhatsApp (e2e)', () => {
  let app: NestFastifyApplication;
  let request: ReturnType<typeof supertest>;
  let whatsapp: FakeWhatsappClient;
  let redis: Redis;
  const ids: string[] = [];

  const newId = () => {
    const id = `wamid.e2e.${randomUUID()}`;
    ids.push(id);
    return id;
  };

  const post = (payload: unknown) => {
    const raw = JSON.stringify(payload);
    return request
      .post(PATH)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signPayload(raw, SECRET))
      .send(raw);
  };

  beforeAll(async () => {
    app = await createApp();
    request = supertest(app.getHttpServer());
    whatsapp = app.get(WHATSAPP_CLIENT);
    redis = app.get(REDIS);
  }, 30000);

  beforeEach(() => {
    whatsapp.clear();
  });

  afterAll(async () => {
    await redis.del(...ids.map(id => `${INBOUND_PREFIX}:${id}`));
    await redis.del(
      ...[ALLOWED, STRANGER].flatMap(phone => [
        `${ORDER_PREFIX}:${phone}`,
        `${LOCK_PREFIX}:${phone}`,
      ]),
    );
    await app.close();
    delete process.env.WHATSAPP_ALLOWED_SENDERS;
  }, 30000);

  it('número fora da lista recebe 200, não é lido, não é respondido e não ocupa o dedup', async () => {
    const id = newId();
    await post(textWebhook('oi', id, STRANGER)).expect(200);

    await new Promise(resolve => setTimeout(resolve, 200));
    expect(whatsapp.read).toEqual([]);
    expect(whatsapp.sent).toEqual([]);
    await expect(redis.exists(`${INBOUND_PREFIX}:${id}`)).resolves.toBe(0);
    await expect(redis.get(`${ORDER_PREFIX}:${STRANGER}`)).resolves.toBeNull();
  });

  it('número da lista é atendido normalmente', async () => {
    const id = newId();
    await post(textWebhook('cancelar', id, ALLOWED)).expect(200);

    await vi.waitFor(() => expect(whatsapp.sent).toHaveLength(1));
    expect(whatsapp.read).toEqual([id]);
    expect(whatsapp.sent[0]).toMatchObject({ to: ALLOWED });
  });
});
