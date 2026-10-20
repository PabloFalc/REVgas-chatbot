import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type Redis from 'ioredis';
import { REDIS } from 'src/infra/cache/redis.client';
import { FakeWhatsappClient } from 'src/integrations/whatsapp/fake-whatsapp.client';
import { textWebhook } from 'src/integrations/whatsapp/testing/webhook.testing';
import { signPayload } from 'src/integrations/whatsapp/webhook/signature';
import { WHATSAPP_CLIENT } from 'src/integrations/whatsapp/whatsapp.client';
import { INBOUND_PREFIX } from 'src/modules/conversation/conversation.repository';
import supertest from 'supertest';
import { createApp } from '../setup-e2e';

const SECRET = 'e2e-whatsapp-app-secret-0123456789';
const VERIFY = 'e2e-whatsapp-verify-token';
const PATH = '/webhooks/whatsapp';

describe('Webhook do WhatsApp (e2e)', () => {
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

  const post = (payload: unknown, signature?: string) => {
    const raw = JSON.stringify(payload);
    const req = request.post(PATH).set('Content-Type', 'application/json');
    return req.set('X-Hub-Signature-256', signature ?? signPayload(raw, SECRET)).send(raw);
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
    if (ids.length > 0) {
      await redis.del(...ids.map(id => `${INBOUND_PREFIX}:${id}`));
    }
    await app.close();
  }, 30000);

  it('usa o cliente simulado nos testes', () => {
    expect(whatsapp).toBeInstanceOf(FakeWhatsappClient);
  });

  describe('GET (verificação da Meta)', () => {
    it('devolve o challenge em texto puro quando o verify token confere', async () => {
      const response = await request.get(PATH).query({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY,
        'hub.challenge': '1158201444',
      });

      expect(response.status).toBe(200);
      expect(response.text).toBe('1158201444');
      expect(response.headers['content-type']).toMatch(/^text\/plain/);
    });

    it('query repetida ou longa demais → 400', async () => {
      const repeated = await request.get(
        `${PATH}?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1&hub.challenge=2`,
      );
      const long = await request.get(PATH).query({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY,
        'hub.challenge': 'x'.repeat(300),
      });

      expect(repeated.status).toBe(400);
      expect(long.status).toBe(400);
    });

    it('verify token errado → 403', async () => {
      const response = await request.get(PATH).query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'errado',
        'hub.challenge': '1',
      });

      expect(response.status).toBe(403);
    });
  });

  describe('POST (eventos)', () => {
    it('responde a mensagem de texto pelo WhatsApp', async () => {
      const id = newId();
      const response = await post(textWebhook('oi', id));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
      await vi.waitFor(() => expect(whatsapp.sent).toHaveLength(1));
      expect(whatsapp.read).toEqual([id]);
      expect(whatsapp.sent[0]).toMatchObject({ type: 'text', to: '5586999991234' });
    });

    it('não responde de novo quando a Meta reenvia o mesmo evento', async () => {
      const payload = textWebhook('lista', newId());

      await post(payload).expect(200);
      await post(payload).expect(200);

      await vi.waitFor(() => expect(whatsapp.sent).toHaveLength(1));
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(whatsapp.sent).toHaveLength(1);
      expect(whatsapp.sent[0].type).toBe('list');
    });

    it('assinatura inválida ou ausente → 401 e nada é enviado', async () => {
      const payload = textWebhook('oi', newId());

      await post(payload, signPayload('{}', SECRET)).expect(401);
      await request.post(PATH).send(payload).expect(401);

      expect(whatsapp.sent).toEqual([]);
    });

    it('corpo que não é JSON não tem corpo cru para conferir → 401', async () => {
      const raw = JSON.stringify(textWebhook('oi', newId()));
      await request
        .post(PATH)
        .set('Content-Type', 'text/plain')
        .set('X-Hub-Signature-256', signPayload(raw, SECRET))
        .send(raw)
        .expect(401);

      expect(whatsapp.sent).toEqual([]);
    });

    it('payload que não é do WhatsApp é aceito e ignorado', async () => {
      await post({ object: 'page', entry: [] }).expect(200);
      expect(whatsapp.sent).toEqual([]);
    });
  });
});
