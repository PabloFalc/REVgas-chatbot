import { safeEqual } from '../../../utils/safe-equal';
import type { WhatsappConfig } from '../shared/whatsapp.config';
import { isValidSignature } from './signature';
import { parseWebhook } from './webhook.parser';
import type { WebhookEvent } from './webhook.schemas';

export const WHATSAPP_WEBHOOK = Symbol('WHATSAPP_WEBHOOK');

export type VerificationQuery = {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
};

export class WhatsappWebhook {
  constructor(
    private readonly config: Pick<WhatsappConfig, 'appSecret' | 'verifyToken' | 'phoneNumberId'>,
  ) {}

  challenge(query: VerificationQuery): string | null {
    const { verifyToken } = this.config;
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (!verifyToken || query['hub.mode'] !== 'subscribe' || !token || !challenge) {
      return null;
    }
    return safeEqual(token, verifyToken) ? challenge : null;
  }

  isAuthentic(rawBody: Buffer | string | undefined, signature: string | undefined): boolean {
    if (!this.config.appSecret) {
      return true;
    }
    return isValidSignature(rawBody, signature, this.config.appSecret);
  }

  parse(payload: unknown): WebhookEvent[] {
    const events = parseWebhook(payload);
    const { phoneNumberId } = this.config;
    if (!phoneNumberId) {
      return events;
    }
    return events.filter(event => event.phoneNumberId === phoneNumberId);
  }
}
