import type { z } from 'zod';
import { WhatsappInvalidMessageError } from '../../../core/erros/whatsapp/whatsapp.errors';
import {
  type ButtonsMessage,
  buttonsMessageSchema,
  type ListMessage,
  listMessageSchema,
  type TextMessage,
  textMessageSchema,
} from './messages.schemas';

export type MessageType = 'text' | 'buttons' | 'list';

export interface MessagePayload {
  type: MessageType;
  to: string;
  body: Record<string, unknown>;
}

function validate<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new WhatsappInvalidMessageError(
      result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

function textOrNothing(key: 'header' | 'footer', value?: string) {
  if (!value) {
    return {};
  }
  return key === 'header' ? { header: { type: 'text', text: value } } : { footer: { text: value } };
}

function envelope(to: string, content: Record<string, unknown>): Record<string, unknown> {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...content };
}

export function textPayload(input: TextMessage): MessagePayload {
  const message = validate(textMessageSchema, input);
  return {
    type: 'text',
    to: message.to,
    body: envelope(message.to, {
      type: 'text',
      text: { body: message.text, preview_url: message.previewUrl ?? false },
    }),
  };
}

export function buttonsPayload(input: ButtonsMessage): MessagePayload {
  const message = validate(buttonsMessageSchema, input);
  return {
    type: 'buttons',
    to: message.to,
    body: envelope(message.to, {
      type: 'interactive',
      interactive: {
        type: 'button',
        ...textOrNothing('header', message.header),
        body: { text: message.body },
        ...textOrNothing('footer', message.footer),
        action: {
          buttons: message.buttons.map(button => ({
            type: 'reply',
            reply: { id: button.id, title: button.title },
          })),
        },
      },
    }),
  };
}

export function listPayload(input: ListMessage): MessagePayload {
  const message = validate(listMessageSchema, input);
  return {
    type: 'list',
    to: message.to,
    body: envelope(message.to, {
      type: 'interactive',
      interactive: {
        type: 'list',
        ...textOrNothing('header', message.header),
        body: { text: message.body },
        ...textOrNothing('footer', message.footer),
        action: {
          button: message.buttonText,
          sections: message.sections.map(section => ({
            ...(section.title ? { title: section.title } : {}),
            rows: section.rows.map(row => ({
              id: row.id,
              title: row.title,
              ...(row.description ? { description: row.description } : {}),
            })),
          })),
        },
      },
    }),
  };
}

export function readPayload(messageId: string): Record<string, unknown> {
  return { messaging_product: 'whatsapp', status: 'read', message_id: messageId };
}
