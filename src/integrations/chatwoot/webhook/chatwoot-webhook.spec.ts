import { describe, expect, it } from 'vitest';
import { agentMessageWebhook, resolvedWebhook, signedHeaders } from '../testing/webhook.testing';
import { ChatwootWebhook } from './chatwoot-webhook';

const PHONE = '5586999991234';
const SECRET = 's'.repeat(20);
const webhook = new ChatwootWebhook({ webhookSecret: SECRET, inboxId: 1 });

type Mutable = {
  sender: unknown;
  message_type: string;
  conversation: {
    contact_inbox?: unknown;
    meta: { sender: { identifier: string } };
  };
};

function mutable(payload: object): Mutable {
  return structuredClone(payload) as Mutable;
}

describe('ChatwootWebhook.parse', () => {
  it('converte mensagem humana em agentMessage', () => {
    const events = webhook.parse(
      agentMessageWebhook({
        phone: PHONE,
        content: 'Olá!',
        messageId: 55,
        conversationId: 12,
        agentName: 'Maria',
      }),
    );
    expect(events).toEqual([
      {
        kind: 'agentMessage',
        messageId: 55,
        conversationId: 12,
        inboxId: 1,
        phone: PHONE,
        agentName: 'Maria',
        content: 'Olá!',
      },
    ]);
  });

  it('usa Atendente quando o remetente não tem nome', () => {
    const payload = mutable(agentMessageWebhook({ phone: PHONE, content: 'oi' }));
    payload.sender = { id: 5, type: 'user' };
    expect(webhook.parse(payload)?.[0]).toMatchObject({
      kind: 'agentMessage',
      agentName: 'Atendente',
    });
  });

  it.each([
    ['agent_bot', { senderType: 'agent_bot' as const }],
    ['incoming', { messageType: 'incoming' as const }],
    ['private', { private: true }],
    ['conteúdo vazio', { content: '' }],
    ['outra caixa', { inboxId: 2 }],
  ])('ignora %s', (_name, override) => {
    const payload = agentMessageWebhook({ phone: PHONE, content: 'oi', ...override });
    expect(webhook.parse(payload)).toEqual([]);
  });

  it('ignora message_type template', () => {
    const payload = mutable(agentMessageWebhook({ phone: PHONE, content: 'oi' }));
    payload.message_type = 'template';
    expect(webhook.parse(payload)).toEqual([]);
  });

  it('converte status resolved em conversationResolved', () => {
    expect(webhook.parse(resolvedWebhook({ phone: PHONE, conversationId: 12 }))).toEqual([
      { kind: 'conversationResolved', conversationId: 12, inboxId: 1, phone: PHONE },
    ]);
  });

  it('ignora status open e resolved de outra caixa', () => {
    const open = { ...resolvedWebhook({ phone: PHONE }), status: 'open' };
    expect(webhook.parse(open)).toEqual([]);
    expect(webhook.parse(resolvedWebhook({ phone: PHONE, inboxId: 9 }))).toEqual([]);
  });

  it('ignora outros eventos', () => {
    expect(webhook.parse({ event: 'conversation_created', id: 1 })).toEqual([]);
  });

  it('devolve null para payload inválido', () => {
    expect(webhook.parse('x')).toBeNull();
    expect(webhook.parse({})).toBeNull();
    expect(webhook.parse(null)).toBeNull();
    expect(webhook.parse({ event: 3 })).toBeNull();
  });

  it('phone nulo quando o identificador não casa e não há source_id', () => {
    const payload = mutable(agentMessageWebhook({ phone: 'abc', content: 'oi' }));
    payload.conversation.contact_inbox = undefined;
    expect(webhook.parse(payload)?.[0]).toMatchObject({ kind: 'agentMessage', phone: null });
  });

  it('cai para source_id quando o identifier é inválido', () => {
    const payload = mutable(agentMessageWebhook({ phone: PHONE, content: 'oi' }));
    payload.conversation.meta.sender.identifier = 'abc';
    expect(webhook.parse(payload)?.[0]).toMatchObject({ phone: PHONE });
  });

  it('sem inboxId configurado aceita qualquer caixa', () => {
    const open = new ChatwootWebhook({ webhookSecret: SECRET, inboxId: undefined });
    const payload = agentMessageWebhook({ phone: PHONE, content: 'oi', inboxId: 5 });
    expect(open.parse(payload)).toHaveLength(1);
  });
});

describe('signedHeaders', () => {
  it('gera headers que o webhook aceita', () => {
    const raw = JSON.stringify(agentMessageWebhook({ phone: PHONE, content: 'oi' }));
    const now = Date.now();
    const headers = signedHeaders(raw, SECRET, now);
    expect(
      webhook.isAuthentic(
        raw,
        headers['x-chatwoot-signature'],
        headers['x-chatwoot-timestamp'],
        now,
      ),
    ).toBe(true);
  });
});
