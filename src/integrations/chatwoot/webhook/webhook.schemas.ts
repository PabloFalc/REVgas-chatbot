import { z } from 'zod';

export const PHONE_PATTERN = /^\d{8,15}$/;

const senderSchema = z.object({ name: z.string().nullish(), type: z.string().nullish() });

const conversationRefSchema = z.object({
  id: z.number(),
  inbox_id: z.number().nullish(),
  contact_inbox: z.object({ source_id: z.string().nullish() }).nullish(),
  meta: z.object({ sender: z.object({ identifier: z.string().nullish() }).nullish() }).nullish(),
});

export const messageCreatedSchema = z.object({
  id: z.number(),
  content: z.string().nullish(),
  message_type: z.string(),
  private: z.boolean().nullish(),
  sender: senderSchema.nullish(),
  conversation: conversationRefSchema,
  inbox: z.object({ id: z.number() }).nullish(),
});

export const conversationStatusChangedSchema = conversationRefSchema.extend({
  status: z.string(),
});

export type ChatwootEvent =
  | {
      kind: 'agentMessage';
      messageId: number;
      conversationId: number;
      inboxId: number;
      phone: string | null;
      agentName: string;
      content: string;
    }
  | {
      kind: 'conversationResolved';
      conversationId: number;
      inboxId: number;
      phone: string | null;
    };
