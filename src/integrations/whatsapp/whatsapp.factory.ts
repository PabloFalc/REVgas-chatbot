import { CloudApiWhatsappClient, type WhatsappLogger } from './cloud-api-whatsapp.client';
import { FakeWhatsappClient } from './fake-whatsapp.client';
import type { WhatsappConfig } from './shared/whatsapp.config';
import { WhatsappWebhook } from './webhook/whatsapp-webhook';
import type { WhatsappClient } from './whatsapp.client';

export type CreateWhatsappDeps = {
  logger?: WhatsappLogger;
  fetch?: typeof fetch;
  nodeEnv?: string;
};

const noopLogger: WhatsappLogger = { info: () => undefined, warn: () => undefined };

export function createWhatsappClient(
  config: WhatsappConfig,
  deps: CreateWhatsappDeps = {},
): WhatsappClient {
  const logger = deps.logger ?? noopLogger;

  if (config.mode === 'fake') {
    if (deps.nodeEnv === 'production') {
      logger.warn(
        { mode: config.mode },
        'Cliente WhatsApp simulado em produção (WHATSAPP_MODE=fake): nenhuma mensagem sai',
      );
    }
    return new FakeWhatsappClient({ logger, logContent: deps.nodeEnv !== 'production' });
  }

  return new CloudApiWhatsappClient({
    baseUrl: config.baseUrl,
    apiVersion: config.apiVersion,
    phoneNumberId: config.phoneNumberId as string,
    accessToken: config.accessToken as string,
    timeoutMs: config.timeoutMs,
    logger,
    fetch: deps.fetch,
  });
}

export function createWhatsappWebhook(config: WhatsappConfig): WhatsappWebhook {
  return new WhatsappWebhook(config);
}
