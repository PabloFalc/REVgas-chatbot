import type {
  ButtonsMessage,
  ListMessage,
  SentMessage,
  TextMessage,
} from './messages/messages.schemas';

export const WHATSAPP_CLIENT = Symbol('WHATSAPP_CLIENT');

export interface WhatsappClient {
  sendText(message: TextMessage): Promise<SentMessage>;
  sendButtons(message: ButtonsMessage): Promise<SentMessage>;
  sendList(message: ListMessage): Promise<SentMessage>;
  markAsRead(messageId: string): Promise<void>;
}
