import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type Redis from 'ioredis';
import { REDIS } from 'src/infra/cache/redis.client';
import { CHATWOOT_CLIENT } from 'src/integrations/chatwoot/chatwoot.client';
import { FakeChatwootClient } from 'src/integrations/chatwoot/fake-chatwoot.client';
import {
  agentMessageWebhook,
  resolvedWebhook,
  signedHeaders,
} from 'src/integrations/chatwoot/testing/webhook.testing';
import { FakeWhatsappClient } from 'src/integrations/whatsapp/fake-whatsapp.client';
import { textWebhook } from 'src/integrations/whatsapp/testing/webhook.testing';
import { signPayload } from 'src/integrations/whatsapp/webhook/signature';
import { WHATSAPP_CLIENT } from 'src/integrations/whatsapp/whatsapp.client';
import {
  INBOUND_PREFIX,
  LOCK_PREFIX,
  ORDER_PREFIX,
} from 'src/modules/conversation/conversation.repository';
import { msg } from 'src/modules/conversation/flow/messages';
import {
  CONTACT_PREFIX,
  DESK_EVENT_PREFIX,
  HANDOFF_PREFIX,
  THREAD_PREFIX,
} from 'src/modules/handoff/handoff.repository';
import supertest from 'supertest';
import { createApp } from '../setup-e2e';

const WHATSAPP_SECRET = 'e2e-whatsapp-app-secret-0123456789';
const DESK_SECRET = 'e2e-chatwoot-webhook-secret';
const DESK_PATH = '/webhooks/chatwoot';
const WHATSAPP_PATH = '/webhooks/whatsapp';

describe('Webhook do Chatwoot (e2e)', () => {
  let app: NestFastifyApplication;
  let request: ReturnType<typeof supertest>;
  let whatsapp: FakeWhatsappClient;
  let chatwoot: FakeChatwootClient;
  let redis: Redis;
  const phones: string[] = [];
  const inboundIds: string[] = [];
  const deskMessageIds: number[] = [];

  const newPhone = () => {
    const phone = `55869${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    phones.push(phone);
    return phone;
  };

  const newDeskMessageId = () => {
    const id = Math.floor(1_000_000 + Math.random() * 8_999_999);
    deskMessageIds.push(id);
    return id;
  };

  const sentBodies = () => whatsapp.sent.map(sent => JSON.stringify(sent.body)).join(' ');

  const postDesk = (payload: unknown, nowMs?: number) => {
    const raw = JSON.stringify(payload);
    return request
      .post(DESK_PATH)
      .set('Content-Type', 'application/json')
      .set(signedHeaders(raw, DESK_SECRET, nowMs))
      .send(raw);
  };

  const postCustomer = (text: string, phone: string) => {
    const id = `wamid.e2e.${randomUUID()}`;
    inboundIds.push(id);
    const raw = JSON.stringify(textWebhook(text, id, phone));
    return request
      .post(WHATSAPP_PATH)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signPayload(raw, WHATSAPP_SECRET))
      .send(raw);
  };

  const handoffStatus = async (phone: string) => {
    const raw = await redis.get(`${HANDOFF_PREFIX}:${phone}`);
    return raw === null ? null : (JSON.parse(raw) as { status: string }).status;
  };

  const settle = () => new Promise(resolve => setTimeout(resolve, 200));

  beforeAll(async () => {
    app = await createApp();
    request = supertest(app.getHttpServer());
    whatsapp = app.get(WHATSAPP_CLIENT);
    chatwoot = app.get(CHATWOOT_CLIENT);
    redis = app.get(REDIS);
  }, 30000);

  beforeEach(() => {
    whatsapp.clear();
    chatwoot.clear();
  });

  afterAll(async () => {
    if (inboundIds.length > 0) {
      await redis.del(...inboundIds.map(id => `${INBOUND_PREFIX}:${id}`));
    }
    if (deskMessageIds.length > 0) {
      await redis.del(...deskMessageIds.map(id => `${DESK_EVENT_PREFIX}:${id}`));
    }
    if (phones.length > 0) {
      await redis.del(
        ...phones.flatMap(phone => [
          `${ORDER_PREFIX}:${phone}`,
          `${LOCK_PREFIX}:${phone}`,
          `${HANDOFF_PREFIX}:${phone}`,
          `${THREAD_PREFIX}:${phone}`,
          `${CONTACT_PREFIX}:${phone}`,
        ]),
      );
    }
    await app.close();
  }, 30000);

  it('usa os clientes simulados nos testes', () => {
    expect(whatsapp).toBeInstanceOf(FakeWhatsappClient);
    expect(chatwoot).toBeInstanceOf(FakeChatwootClient);
  });

  describe('assinatura e formato', () => {
    it('sem assinatura → 401', async () => {
      const payload = agentMessageWebhook({ phone: newPhone(), content: 'Olá' });

      await request.post(DESK_PATH).send(payload).expect(401);

      expect(whatsapp.sent).toEqual([]);
    });

    it('timestamp velho → 401', async () => {
      const payload = agentMessageWebhook({ phone: newPhone(), content: 'Olá' });

      await postDesk(payload, Date.now() - 10 * 60_000).expect(401);

      expect(whatsapp.sent).toEqual([]);
    });

    it('assinado com corpo que não é evento → 400', async () => {
      await postDesk('x').expect(400);
    });
  });

  describe('mensagem do atendente', () => {
    it('mensagem humana vai para o WhatsApp e deixa o handoff ativo', async () => {
      const phone = newPhone();
      const messageId = newDeskMessageId();

      const response = await postDesk(agentMessageWebhook({ phone, content: 'Olá', messageId }));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
      await vi.waitFor(() => expect(whatsapp.sent).toHaveLength(1));
      expect(whatsapp.sent[0]).toMatchObject({ type: 'text', to: phone });
      expect(sentBodies()).toContain('*Maria (atendente):* Olá');
      await vi.waitFor(async () => expect(await handoffStatus(phone)).toBe('active'));
    });

    it('nota privada e mensagem do bot não são enviadas', async () => {
      const phone = newPhone();

      await postDesk(
        agentMessageWebhook({
          phone,
          content: 'nota',
          private: true,
          messageId: newDeskMessageId(),
        }),
      ).expect(200);
      await postDesk(
        agentMessageWebhook({
          phone,
          content: 'bot',
          senderType: 'agent_bot',
          messageId: newDeskMessageId(),
        }),
      ).expect(200);

      await settle();
      expect(whatsapp.sent).toEqual([]);
      await expect(handoffStatus(phone)).resolves.toBeNull();
    });
  });

  describe('fluxo completo', () => {
    it('atendente pelo WhatsApp, resposta humana, bot em silêncio e volta após resolver', async () => {
      const phone = newPhone();

      await postCustomer('atendente', phone).expect(200);
      await vi.waitFor(() => expect(whatsapp.sent.length).toBeGreaterThan(0));
      expect(sentBodies()).toContain(msg.handoffQueued);
      await vi.waitFor(() => expect(chatwoot.conversations.size).toBe(1));
      const conversation = [...chatwoot.conversations.values()][0];
      expect(conversation?.status).toBe('open');
      whatsapp.clear();

      await postDesk(
        agentMessageWebhook({
          phone,
          content: 'Posso ajudar',
          messageId: newDeskMessageId(),
          conversationId: conversation?.id,
        }),
      ).expect(200);
      await vi.waitFor(() => expect(whatsapp.sent).toHaveLength(1));
      expect(sentBodies()).toContain('*Maria (atendente):* Posso ajudar');
      whatsapp.clear();

      await postCustomer('oi', phone).expect(200);
      await vi.waitFor(() =>
        expect(
          conversation?.messages.some(item => item.type === 'incoming' && item.content === 'oi'),
        ).toBe(true),
      );
      await settle();
      expect(whatsapp.sent).toEqual([]);

      await postDesk(resolvedWebhook({ phone, conversationId: conversation?.id })).expect(200);
      await vi.waitFor(async () => expect(await handoffStatus(phone)).toBeNull());

      await postCustomer('oi', phone).expect(200);
      await vi.waitFor(() => expect(whatsapp.sent.length).toBeGreaterThan(0));
    });
  });
});
