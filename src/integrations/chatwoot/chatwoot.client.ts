export const CHATWOOT_CLIENT = Symbol('CHATWOOT_CLIENT');

export type ConversationStatus = 'open' | 'pending' | 'resolved';

export interface ChatwootContact {
  id: number;
  identifier: string | null;
  sourceIds: Record<number, string>;
}

export interface ChatwootClient {
  findContact(identifier: string): Promise<ChatwootContact | null>;
  createContact(input: {
    name: string;
    identifier: string;
    phoneNumber: string;
    sourceId: string;
  }): Promise<{ contactId: number; sourceId: string }>;
  createContactInbox(contactId: number, sourceId: string): Promise<{ sourceId: string }>;
  createConversation(input: {
    contactId: number;
    sourceId: string;
    status: ConversationStatus;
  }): Promise<{ id: number }>;
  createMessage(
    conversationId: number,
    input: { content: string; type: 'incoming' | 'outgoing'; private?: boolean },
  ): Promise<{ id: number }>;
  setStatus(conversationId: number, status: ConversationStatus): Promise<void>;
}
