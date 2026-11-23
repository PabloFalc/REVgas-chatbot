import { maskPhone } from '../../../utils/mask';
import { safeEqual } from '../../../utils/safe-equal';
import type { WhatsappLogger } from '../cloud-api-whatsapp.client';
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
    private readonly config: Pick<
      WhatsappConfig,
      'appSecret' | 'verifyToken' | 'phoneNumberId' | 'allowedSenders'
    >,
    private readonly logger?: WhatsappLogger,
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
    const { phoneNumberId } = this.config;
    return parseWebhook(payload)
      .filter(event => !phoneNumberId || event.phoneNumberId === phoneNumberId)
      .filter(event => this.isAllowed(event));
  }

  private isAllowed(event: WebhookEvent): boolean {
    const { allowedSenders } = this.config;
    if (event.kind !== 'message' || allowedSenders.length === 0) {
      return true;
    }
    if (allowedSenders.includes(event.from)) {
      return true;
    }
    this.logger?.warn(
      { component: 'whatsapp', from: maskPhone(event.from) },
      'Mensagem de número fora de WHATSAPP_ALLOWED_SENDERS ignorada',
    );
    return false;
  }
}
