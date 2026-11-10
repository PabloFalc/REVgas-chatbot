import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type Redis from 'ioredis';
import { REDIS } from 'src/infra/cache/redis.client';
import { FakeLlmClient } from 'src/integrations/llm/fake-llm.client';
import { LLM_CLIENT } from 'src/integrations/llm/llm.client';
import type { FakeWhatsappClient } from 'src/integrations/whatsapp/fake-whatsapp.client';
import { textWebhook } from 'src/integrations/whatsapp/testing/webhook.testing';
import { signPayload } from 'src/integrations/whatsapp/webhook/signature';
import { WHATSAPP_CLIENT } from 'src/integrations/whatsapp/whatsapp.client';
import {
  INBOUND_PREFIX,
  LOCK_PREFIX,
  MISUNDERSTOOD_PREFIX,
  OFFENSE_PREFIX,
  ORDER_PREFIX,
} from 'src/modules/conversation/conversation.repository';
import { msg } from 'src/modules/conversation/flow/messages';
import supertest from 'supertest';
import { createApp } from '../setup-e2e';

const SECRET = 'e2e-whatsapp-app-secret-0123456789';
const PATH = '/webhooks/whatsapp';

describe('Fluxo com dúvidas e proteções (e2e)', () => {
  let app: NestFastifyApplication;
  let request: ReturnType<typeof supertest>;
  let whatsapp: FakeWhatsappClient;
  let llm: FakeLlmClient;
  let redis: Redis;
  const ids: string[] = [];
  const phones: string[] = [];

  const newPhone = () => {
    const phone = `55869${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    phones.push(phone);
    return phone;
  };

  const newId = () => {
    const id = `wamid.e2e.${randomUUID()}`;
    ids.push(id);
    return id;
  };

  const send = (text: string, phone: string) => {
    const raw = JSON.stringify(textWebhook(text, newId(), phone));
    return request
      .post(PATH)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signPayload(raw, SECRET))
      .send(raw)
      .expect(200);
  };

  const questionOf = (topic: 'general') => ({
    intent: 'question',
    products: null,
    quantity: null,
    payment: null,
    address: null,
    newAddress: null,
    topic,
    unknownProduct: null,
    confidence: 0.95,
  });

  const programQuestion = () => {
    llm.respondWith(request_ => {
      if (request_.operation === 'kb-answer') return { object: { answer: null, sources: [] } };
      return { object: questionOf('general') };
    });
  };

  const bodyOf = (sent: { body: Record<string, unknown> }) => JSON.stringify(sent.body);

  beforeAll(async () => {
    app = await createApp();
    request = supertest(app.getHttpServer());
    whatsapp = app.get(WHATSAPP_CLIENT);
    llm = app.get(LLM_CLIENT);
    redis = app.get(REDIS);
  }, 30000);

  beforeEach(() => {
    whatsapp.clear();
    llm.clear();
  });

  afterAll(async () => {
    llm.clear();
    if (ids.length > 0) {
      await redis.del(...ids.map(id => `${INBOUND_PREFIX}:${id}`));
    }
    if (phones.length > 0) {
      await redis.del(
        ...phones.flatMap(phone => [
          `${ORDER_PREFIX}:${phone}`,
          `${LOCK_PREFIX}:${phone}`,
          `${MISUNDERSTOOD_PREFIX}:${phone}`,
          `${OFFENSE_PREFIX}:${phone}`,
        ]),
      );
      for (const phone of phones) {
        const keys = await redis.keys(`handoff:*${phone}*`);
        if (keys.length > 0) await redis.del(...keys);
      }
    }
    await app.close();
  }, 30000);

  it('usa a LLM simulada nos testes', () => {
    expect(llm).toBeInstanceOf(FakeLlmClient);
  });

  it('mensagem de vazamento responde o texto de segurança e o atendimento, sem chamar a IA', async () => {
    const phone = newPhone();

    await send('tem cheiro de gás aqui', phone);

    await vi.waitFor(() => expect(whatsapp.sent.length).toBeGreaterThanOrEqual(2));
    expect(bodyOf(whatsapp.sent[0])).toContain(msg.emergency);
    const second = bodyOf(whatsapp.sent[1]);
    expect(
      [
        msg.handoffQueued,
        msg.handoffAlreadyQueued,
        msg.talkToStore(),
        'Estamos fechados agora',
      ].some(text => second.includes(text)),
    ).toBe(true);
    expect(llm.calls).toHaveLength(0);
  });

  it('dúvida no meio do pedido responde "não sei" com botão de atendente e repete a pergunta', async () => {
    const phone = newPhone();
    await send('oi', phone);
    await vi.waitFor(() => expect(whatsapp.sent.length).toBeGreaterThan(0));
    whatsapp.clear();
    await send('Maria Silva', phone);
    await vi.waitFor(() => expect(bodyOf(whatsapp.sent[0])).toContain(msg.askCpf));
    const saved = async () => {
      const raw = await redis.get(`${ORDER_PREFIX}:${phone}`);
      const { lastInboundAt: _volatile, ...order } = JSON.parse(raw ?? '{}');
      return order;
    };
    const before = await saved();
    expect(before.step).toBe('askCpf');
    expect(before.customer.name).toBe('Maria Silva');
    whatsapp.clear();
    programQuestion();

    await send('vocês entregam domingo?', phone);

    await vi.waitFor(() => expect(whatsapp.sent.length).toBeGreaterThanOrEqual(2));
    const first = bodyOf(whatsapp.sent[0]);
    expect(whatsapp.sent[0].type).toBe('buttons');
    expect(first).toContain(msg.notKnown);
    expect(first).toContain('handoff:request');
    expect(whatsapp.sent.slice(1).map(bodyOf).join(' ')).toContain(msg.askCpf);
    expect(await saved()).toEqual(before);
  });

  it('primeira mensagem que é dúvida oferece "Fazer pedido" e não salva pedido', async () => {
    const phone = newPhone();
    programQuestion();

    await send('vocês entregam domingo?', phone);

    await vi.waitFor(() => expect(whatsapp.sent).toHaveLength(1));
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0].type).toBe('buttons');
    expect(bodyOf(whatsapp.sent[0])).toContain('order:start');
    expect(bodyOf(whatsapp.sent[0])).toContain(msg.orderStart);
    await expect(redis.get(`${ORDER_PREFIX}:${phone}`)).resolves.toBeNull();
  });
});
