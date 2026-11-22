import type { z } from 'zod';
import {
  changeValueSchema,
  type InboundContent,
  inboundMessageSchema,
  statusSchema,
  type WebhookEvent,
  webhookPayloadSchema,
} from './webhook.schemas';

type InboundMessage = z.infer<typeof inboundMessageSchema>;

function toContent(message: InboundMessage): InboundContent {
  if (message.type === 'text' && message.text) {
    return { type: 'text', text: message.text.body };
  }
  if (message.type === 'interactive' && message.interactive) {
    const reply = message.interactive.button_reply ?? message.interactive.list_reply;
    if (reply) {
      return { type: 'reply', replyId: reply.id, title: reply.title };
    }
  }
  if (message.type === 'button' && message.button?.payload) {
    return { type: 'reply', replyId: message.button.payload, title: message.button.text };
  }
  return { type: 'unsupported', originalType: message.type };
}

function toTimestamp(value?: string): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  return Number(value);
}

export function parseWebhook(payload: unknown): WebhookEvent[] {
  const parsed = webhookPayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.object !== 'whatsapp_business_account') {
    return [];
  }

  const events: WebhookEvent[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') {
        continue;
      }
      const value = changeValueSchema.safeParse(change.value);
      if (!value.success) {
        continue;
      }
      const phoneNumberId = value.data.metadata?.phone_number_id;
      const names = new Map<string, string>();
      for (const contact of value.data.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) {
          names.set(contact.wa_id, contact.profile.name);
        }
      }

      for (const raw of value.data.messages ?? []) {
        const message = inboundMessageSchema.safeParse(raw);
        if (!message.success) {
          continue;
        }
        events.push({
          kind: 'message',
          id: message.data.id,
          from: message.data.from,
          name: names.get(message.data.from),
          timestamp: toTimestamp(message.data.timestamp),
          phoneNumberId,
          content: toContent(message.data),
        });
      }

      for (const raw of value.data.statuses ?? []) {
        const status = statusSchema.safeParse(raw);
        if (!status.success) {
          continue;
        }
        events.push({
          kind: 'status',
          id: status.data.id,
          status: status.data.status,
          recipient: status.data.recipient_id,
          phoneNumberId,
          errorCodes: (status.data.errors ?? [])
            .map(error => error.code)
            .filter((code): code is number => typeof code === 'number'),
        });
      }
    }
  }
  return events;
}
