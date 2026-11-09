import { ChatwootError } from '../../core/erros/chatwoot/chatwoot.errors';
import type { ChatwootClient, ChatwootContact, ConversationStatus } from './chatwoot.client';

export interface FakeChatwootMessage {
  id: number;
  content: string;
  type: 'incoming' | 'outgoing';
  private: boolean;
}

export interface FakeChatwootConversation {
  id: number;
  contactId: number;
  status: ConversationStatus;
  messages: FakeChatwootMessage[];
}

export class FakeChatwootClient implements ChatwootClient {
  readonly contacts: ChatwootContact[] = [];
  readonly conversations = new Map<number, FakeChatwootConversation>();
  private nextId = 1;
  private failing = false;

  failNext(): void {
    this.failing = true;
  }

  clear(): void {
    this.contacts.length = 0;
    this.conversations.clear();
    this.nextId = 1;
    this.failing = false;
  }

  async findContact(identifier: string): Promise<ChatwootContact | null> {
    this.maybeFail();
    return this.contacts.find(contact => contact.identifier === identifier) ?? null;
  }

  async createContact(input: {
    name: string;
    identifier: string;
    phoneNumber: string;
    sourceId: string;
  }): Promise<{ contactId: number; sourceId: string }> {
    this.maybeFail();
    const id = this.nextId++;
    this.contacts.push({ id, identifier: input.identifier, sourceIds: { 1: input.sourceId } });
    return { contactId: id, sourceId: input.sourceId };
  }

  async createContactInbox(contactId: number, sourceId: string): Promise<{ sourceId: string }> {
    this.maybeFail();
    const contact = this.contacts.find(item => item.id === contactId);
    if (!contact) {
      throw new ChatwootError('not_found', 'Contato não encontrado', 404);
    }
    contact.sourceIds[1] = sourceId;
    return { sourceId };
  }

  async createConversation(input: {
    contactId: number;
    sourceId: string;
    status: ConversationStatus;
  }): Promise<{ id: number }> {
    this.maybeFail();
    const id = this.nextId++;
    this.conversations.set(id, {
      id,
      contactId: input.contactId,
      status: input.status,
      messages: [],
    });
    return { id };
  }

  async createMessage(
    conversationId: number,
    input: { content: string; type: 'incoming' | 'outgoing'; private?: boolean },
  ): Promise<{ id: number }> {
    this.maybeFail();
    const conversation = this.conversation(conversationId);
    const id = this.nextId++;
    conversation.messages.push({
      id,
      content: input.content,
      type: input.type,
      private: input.private ?? false,
    });
    return { id };
  }

  async setStatus(conversationId: number, status: ConversationStatus): Promise<void> {
    this.maybeFail();
    this.conversation(conversationId).status = status;
  }

  private conversation(id: number): FakeChatwootConversation {
    const conversation = this.conversations.get(id);
    if (!conversation) {
      throw new ChatwootError('not_found', 'Conversa não encontrada', 404);
    }
    return conversation;
  }

  private maybeFail(): void {
    if (this.failing) {
      this.failing = false;
      throw new ChatwootError('unavailable', 'Falha simulada do Chatwoot');
    }
  }
}
