import { safeEqual } from '../../../utils/safe-equal';
import type { ChatwootConfig } from '../shared/chatwoot.config';
import { signChatwootPayload } from './signature';
import {
  type ChatwootEvent,
  conversationStatusChangedSchema,
  messageCreatedSchema,
  PHONE_PATTERN,
} from './webhook.schemas';

export const CHATWOOT_WEBHOOK = Symbol('CHATWOOT_WEBHOOK');

export type { ChatwootEvent } from './webhook.schemas';

const MAX_SKEW_MS = 300_000;
const DEFAULT_AGENT_NAME = 'Atendente';

type ConversationRef = {
  contact_inbox?: { source_id?: string | null } | null;
  meta?: { sender?: { identifier?: string | null } | null } | null;
};

function readPhone(conversation: ConversationRef): string | null {
  const candidates = [conversation.meta?.sender?.identifier, conversation.contact_inbox?.source_id];
  for (const candidate of candidates) {
    if (candidate && PHONE_PATTERN.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

export class ChatwootWebhook {
  constructor(private readonly config: Pick<ChatwootConfig, 'webhookSecret' | 'inboxId'>) {}

  isAuthentic(
    rawBody: Buffer | string | undefined,
    signature: string | undefined,
    timestamp: string | undefined,
    nowMs: number,
  ): boolean {
    const { webhookSecret } = this.config;
    if (!webhookSecret || rawBody === undefined || !signature || !timestamp) {
      return false;
    }
    if (!/^\d+$/.test(timestamp) || Math.abs(nowMs - Number(timestamp) * 1000) > MAX_SKEW_MS) {
      return false;
    }
    return safeEqual(signChatwootPayload(rawBody, timestamp, webhookSecret), signature);
  }

  parse(payload: unknown): ChatwootEvent[] | null {
    if (typeof payload !== 'object' || payload === null) {
      return null;
    }
    const { event } = payload as { event?: unknown };
    if (typeof event !== 'string') {
      return null;
    }
    if (event === 'message_created') {
      return this.parseMessage(payload);
    }
    if (event === 'conversation_status_changed') {
      return this.parseStatus(payload);
    }
    return [];
  }

  private matchesInbox(inboxId: number): boolean {
    const { inboxId: configured } = this.config;
    return configured === undefined || configured === inboxId;
  }

  private parseMessage(payload: unknown): ChatwootEvent[] {
    const parsed = messageCreatedSchema.safeParse(payload);
    if (!parsed.success) {
      return [];
    }
    const message = parsed.data;
    const inboxId = message.inbox?.id ?? message.conversation.inbox_id;
    if (inboxId === undefined || inboxId === null || !this.matchesInbox(inboxId)) {
      return [];
    }
    const content = message.content?.trim();
    if (
      message.message_type !== 'outgoing' ||
      message.private !== false ||
      message.sender?.type !== 'user' ||
      !content
    ) {
      return [];
    }
    return [
      {
        kind: 'agentMessage',
        messageId: message.id,
        conversationId: message.conversation.id,
        inboxId,
        phone: readPhone(message.conversation),
        agentName: message.sender.name?.trim() || DEFAULT_AGENT_NAME,
        content: message.content as string,
      },
    ];
  }

  private parseStatus(payload: unknown): ChatwootEvent[] {
    const parsed = conversationStatusChangedSchema.safeParse(payload);
    if (!parsed.success || parsed.data.status !== 'resolved') {
      return [];
    }
    const { id, inbox_id: inboxId } = parsed.data;
    if (inboxId === undefined || inboxId === null || !this.matchesInbox(inboxId)) {
      return [];
    }
    return [
      { kind: 'conversationResolved', conversationId: id, inboxId, phone: readPhone(parsed.data) },
    ];
  }
}
