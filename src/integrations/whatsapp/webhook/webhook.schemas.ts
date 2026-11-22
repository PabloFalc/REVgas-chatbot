import { z } from 'zod';

const replySchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().optional(),
});

export const inboundMessageSchema = z.looseObject({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: z.string().optional(),
  type: z.string(),
  text: z.looseObject({ body: z.string() }).optional(),
  interactive: z
    .looseObject({
      type: z.string(),
      button_reply: replySchema.optional(),
      list_reply: replySchema.optional(),
    })
    .optional(),
  button: z.looseObject({ payload: z.string().optional(), text: z.string().optional() }).optional(),
});

export const statusSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string(),
  recipient_id: z.string().optional(),
  errors: z
    .array(z.looseObject({ code: z.number().optional(), title: z.string().optional() }))
    .optional(),
});

export const changeValueSchema = z.looseObject({
  metadata: z.looseObject({ phone_number_id: z.string() }).optional(),
  contacts: z
    .array(
      z.looseObject({
        wa_id: z.string().optional(),
        profile: z.looseObject({ name: z.string().optional() }).optional(),
      }),
    )
    .optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
});

export const webhookPayloadSchema = z.looseObject({
  object: z.string(),
  entry: z.array(
    z.looseObject({
      changes: z.array(z.looseObject({ field: z.string(), value: z.unknown() })),
    }),
  ),
});

export type InboundContent =
  | { type: 'text'; text: string }
  | { type: 'reply'; replyId: string; title?: string }
  | { type: 'unsupported'; originalType: string };

export interface InboundMessageEvent {
  kind: 'message';
  id: string;
  from: string;
  name?: string;
  timestamp?: number;
  phoneNumberId?: string;
  content: InboundContent;
}

export interface StatusEvent {
  kind: 'status';
  id: string;
  status: string;
  recipient?: string;
  phoneNumberId?: string;
  errorCodes: number[];
}

export type WebhookEvent = InboundMessageEvent | StatusEvent;
