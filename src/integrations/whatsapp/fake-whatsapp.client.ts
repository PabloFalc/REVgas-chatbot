import { maskPhone } from '../../utils/mask';
import type { WhatsappLogger } from './cloud-api-whatsapp.client';
import {
  buttonsPayload,
  listPayload,
  type MessagePayload,
  type MessageType,
  textPayload,
} from './messages/messages.payload';
import type {
  ButtonsMessage,
  ListMessage,
  SentMessage,
  TextMessage,
} from './messages/messages.schemas';
import type { WhatsappClient } from './whatsapp.client';

export interface FakeSentMessage {
  id: string;
  type: MessageType;
  to: string;
  body: Record<string, unknown>;
}

export type FakeWhatsappOptions = {
  logger?: WhatsappLogger;
  logContent?: boolean;
};

function preview(payload: MessagePayload): string | undefined {
  const body = payload.body as {
    text?: { body?: string };
    interactive?: { body?: { text?: string } };
  };
  return body.text?.body ?? body.interactive?.body?.text;
}

export class FakeWhatsappClient implements WhatsappClient {
  readonly sent: FakeSentMessage[] = [];
  readonly read: string[] = [];
  private sequence = 0;

  constructor(private readonly options: FakeWhatsappOptions = {}) {}

  async sendText(message: TextMessage): Promise<SentMessage> {
    return await this.record(textPayload(message));
  }

  async sendButtons(message: ButtonsMessage): Promise<SentMessage> {
    return await this.record(buttonsPayload(message));
  }

  async sendList(message: ListMessage): Promise<SentMessage> {
    return await this.record(listPayload(message));
  }

  async markAsRead(messageId: string): Promise<void> {
    this.read.push(messageId);
  }

  clear(): void {
    this.sent.length = 0;
    this.read.length = 0;
  }

  private async record(payload: MessagePayload): Promise<SentMessage> {
    this.sequence += 1;
    const id = `wamid.fake.${this.sequence}`;
    this.sent.push({ id, type: payload.type, to: payload.to, body: payload.body });
    this.options.logger?.info(
      {
        component: 'whatsapp',
        mode: 'fake',
        type: payload.type,
        to: maskPhone(payload.to),
        ...(this.options.logContent ? { preview: preview(payload) } : {}),
      },
      'whatsapp fake send',
    );
    return { id };
  }
}
