import type { z } from 'zod';
import { ChatwootError, mapChatwootError } from '../../core/erros/chatwoot/chatwoot.errors';
import { isTimeoutError } from '../../utils/guards';
import { parseJsonOrText } from '../../utils/parse-json';
import type { ChatwootClient, ChatwootContact, ConversationStatus } from './chatwoot.client';
import {
  contactInboxResponseSchema,
  createContactResponseSchema,
  idResponseSchema,
  searchContactsResponseSchema,
} from './chatwoot.schemas';

export type ChatwootLogger = {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
};

export type HttpChatwootOptions = {
  baseUrl: string;
  accountId: number;
  inboxId: number;
  apiToken: string;
  botToken: string;
  timeoutMs: number;
  logger?: ChatwootLogger;
  fetch?: typeof fetch;
  now?: () => number;
};

type Method = 'GET' | 'POST';
type Credential = 'api' | 'bot';

const noopLogger: ChatwootLogger = { info: () => undefined, warn: () => undefined };

export class HttpChatwootClient implements ChatwootClient {
  private readonly root: string;
  private readonly inboxId: number;
  private readonly tokens: Record<Credential, string>;
  private readonly timeoutMs: number;
  private readonly logger: ChatwootLogger;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(options: HttpChatwootOptions) {
    this.root = `${options.baseUrl.replace(/\/+$/, '')}/api/v1/accounts/${options.accountId}`;
    this.inboxId = options.inboxId;
    this.tokens = { api: options.apiToken, bot: options.botToken };
    this.timeoutMs = options.timeoutMs;
    this.logger = options.logger ?? noopLogger;
    this.fetchFn = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async findContact(identifier: string): Promise<ChatwootContact | null> {
    const body = await this.request('findContact', 'GET', 'api', {
      path: `/contacts/search?q=${encodeURIComponent(identifier)}`,
    });
    const { payload } = this.parse(searchContactsResponseSchema, body);
    const match = payload.find(contact => contact.identifier === identifier);
    if (!match) {
      return null;
    }
    const sourceIds: Record<number, string> = {};
    for (const item of match.contact_inboxes) {
      sourceIds[item.inbox.id] = item.source_id;
    }
    return { id: match.id, identifier: match.identifier ?? null, sourceIds };
  }

  async createContact(input: {
    name: string;
    identifier: string;
    phoneNumber: string;
    sourceId: string;
  }): Promise<{ contactId: number; sourceId: string }> {
    const body = await this.request('createContact', 'POST', 'api', {
      path: '/contacts',
      body: {
        inbox_id: this.inboxId,
        name: input.name,
        identifier: input.identifier,
        phone_number: input.phoneNumber,
        source_id: input.sourceId,
      },
    });
    const { payload } = this.parse(createContactResponseSchema, body);
    return { contactId: payload.contact.id, sourceId: payload.contact_inbox.source_id };
  }

  async createContactInbox(contactId: number, sourceId: string): Promise<{ sourceId: string }> {
    const body = await this.request('createContactInbox', 'POST', 'api', {
      path: `/contacts/${contactId}/contact_inboxes`,
      body: { inbox_id: this.inboxId, source_id: sourceId },
    });
    return { sourceId: this.parse(contactInboxResponseSchema, body).source_id };
  }

  async createConversation(input: {
    contactId: number;
    sourceId: string;
    status: ConversationStatus;
  }): Promise<{ id: number }> {
    const body = await this.request('createConversation', 'POST', 'bot', {
      path: '/conversations',
      body: {
        source_id: input.sourceId,
        inbox_id: this.inboxId,
        contact_id: input.contactId,
        status: input.status,
      },
    });
    return { id: this.parse(idResponseSchema, body).id };
  }

  async createMessage(
    conversationId: number,
    input: { content: string; type: 'incoming' | 'outgoing'; private?: boolean },
  ): Promise<{ id: number }> {
    const body = await this.request('createMessage', 'POST', 'bot', {
      path: `/conversations/${conversationId}/messages`,
      body: {
        content: input.content,
        message_type: input.type,
        private: input.private ?? false,
      },
    });
    return { id: this.parse(idResponseSchema, body).id };
  }

  async setStatus(conversationId: number, status: ConversationStatus): Promise<void> {
    await this.request('setStatus', 'POST', 'bot', {
      path: `/conversations/${conversationId}/toggle_status`,
      body: { status },
    });
  }

  private parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ChatwootError('response', 'Resposta do Chatwoot fora do formato esperado', 200);
    }
    return parsed.data;
  }

  private async request(
    op: string,
    method: Method,
    credential: Credential,
    options: { path: string; body?: Record<string, unknown> },
  ): Promise<unknown> {
    const startedAt = this.now();
    const base = { component: 'chatwoot', op };

    try {
      const response = await this.fetchFn(`${this.root}${options.path}`, {
        method,
        headers: {
          api_access_token: this.tokens[credential],
          'Content-Type': 'application/json',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const parsed = parseJsonOrText(await response.text());
      const durationMs = this.now() - startedAt;

      if (!response.ok) {
        this.logger.warn(
          { ...base, status: response.status, durationMs },
          'chatwoot request failed',
        );
        throw mapChatwootError(response.status);
      }
      this.logger.info({ ...base, status: response.status, durationMs }, 'chatwoot request');
      return parsed;
    } catch (error) {
      if (error instanceof ChatwootError) {
        throw error;
      }
      const timedOut = isTimeoutError(error);
      this.logger.warn(
        { ...base, durationMs: this.now() - startedAt, error: timedOut ? 'timeout' : 'network' },
        'chatwoot request failed',
      );
      if (method === 'GET') {
        throw new ChatwootError('unavailable', 'Chatwoot indisponível');
      }
      throw new ChatwootError(
        'unknown_outcome',
        timedOut
          ? 'Chamada ao Chatwoot expirou; não se sabe se foi aplicada'
          : 'Falha de rede na chamada ao Chatwoot; não se sabe se foi aplicada',
      );
    }
  }
}
