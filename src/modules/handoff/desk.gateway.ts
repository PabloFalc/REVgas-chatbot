import { Inject, Injectable } from '@nestjs/common';
import { CHATWOOT_CLIENT, type ChatwootClient } from 'src/integrations/chatwoot/chatwoot.client';
import {
  CHATWOOT_CONFIG,
  type ChatwootConfig,
} from 'src/integrations/chatwoot/shared/chatwoot.config';
import type { DeskContact } from './contracts/handoff.types';

@Injectable()
export class DeskGateway {
  constructor(
    @Inject(CHATWOOT_CLIENT) private readonly client: ChatwootClient | null,
    @Inject(CHATWOOT_CONFIG) private readonly config: ChatwootConfig,
  ) {}

  get enabled(): boolean {
    return this.client !== null;
  }

  async ensureContact(
    phone: string,
    name: string | undefined,
    cached: DeskContact | null,
  ): Promise<DeskContact> {
    if (cached) return cached;
    const client = this.requireClient();
    const existing = await client.findContact(phone);
    if (existing) {
      const known =
        this.config.inboxId === undefined ? undefined : existing.sourceIds[this.config.inboxId];
      if (known) return { contactId: existing.id, sourceId: known };
      const { sourceId } = await client.createContactInbox(existing.id, phone);
      return { contactId: existing.id, sourceId };
    }
    return client.createContact({
      name: name ?? phone,
      identifier: phone,
      phoneNumber: `+${phone}`,
      sourceId: phone,
    });
  }

  async openConversation(contact: DeskContact): Promise<number> {
    const { id } = await this.requireClient().createConversation({
      contactId: contact.contactId,
      sourceId: contact.sourceId,
      status: 'pending',
    });
    return id;
  }

  async postIncoming(conversationId: number, text: string): Promise<void> {
    await this.requireClient().createMessage(conversationId, { content: text, type: 'incoming' });
  }

  async postOutgoing(conversationId: number, text: string): Promise<void> {
    await this.requireClient().createMessage(conversationId, { content: text, type: 'outgoing' });
  }

  async postNote(conversationId: number, text: string): Promise<void> {
    await this.requireClient().createMessage(conversationId, {
      content: text,
      type: 'outgoing',
      private: true,
    });
  }

  setStatus(conversationId: number, status: 'open' | 'pending' | 'resolved'): Promise<void> {
    return this.requireClient().setStatus(conversationId, status);
  }

  private requireClient(): ChatwootClient {
    if (!this.client) throw new Error('Chatwoot desativado');
    return this.client;
  }
}
