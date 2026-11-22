import { signChatwootPayload } from '../webhook/signature';

export function agentMessageWebhook(opts: {
  phone: string;
  content: string;
  messageId?: number;
  conversationId?: number;
  senderType?: 'user' | 'agent_bot';
  messageType?: 'incoming' | 'outgoing';
  private?: boolean;
  inboxId?: number;
  agentName?: string;
}) {
  const inboxId = opts.inboxId ?? 1;
  return {
    event: 'message_created',
    id: opts.messageId ?? 100,
    content: opts.content,
    message_type: opts.messageType ?? 'outgoing',
    private: opts.private ?? false,
    sender: { id: 5, name: opts.agentName ?? 'Maria', type: opts.senderType ?? 'user' },
    conversation: {
      id: opts.conversationId ?? 10,
      inbox_id: inboxId,
      status: 'open',
      contact_inbox: { source_id: opts.phone },
      meta: { sender: { id: 9, identifier: opts.phone, type: 'contact' } },
    },
    inbox: { id: inboxId, name: 'Whatsapp' },
    account: { id: 1 },
  };
}

export function resolvedWebhook(opts: {
  phone: string;
  conversationId?: number;
  inboxId?: number;
}) {
  return {
    event: 'conversation_status_changed',
    id: opts.conversationId ?? 10,
    inbox_id: opts.inboxId ?? 1,
    status: 'resolved',
    contact_inbox: { source_id: opts.phone },
    meta: { sender: { id: 9, identifier: opts.phone, type: 'contact' } },
    changed_attributes: [{ status: { previous_value: 'open', current_value: 'resolved' } }],
  };
}

export function signedHeaders(
  raw: string,
  secret: string,
  nowMs: number = Date.now(),
): Record<string, string> {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    'x-chatwoot-signature': signChatwootPayload(raw, timestamp, secret),
    'x-chatwoot-timestamp': timestamp,
  };
}
