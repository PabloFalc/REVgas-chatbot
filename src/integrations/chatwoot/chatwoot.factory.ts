import type { ChatwootClient } from './chatwoot.client';
import { FakeChatwootClient } from './fake-chatwoot.client';
import { type ChatwootLogger, HttpChatwootClient } from './http-chatwoot.client';
import type { ChatwootConfig } from './shared/chatwoot.config';

export type CreateChatwootDeps = {
  logger?: ChatwootLogger;
  fetch?: typeof fetch;
};

export function createChatwootClient(
  config: ChatwootConfig,
  deps: CreateChatwootDeps = {},
): ChatwootClient | null {
  if (config.mode === 'off') {
    return null;
  }
  if (config.mode === 'fake') {
    return new FakeChatwootClient();
  }
  return new HttpChatwootClient({
    baseUrl: config.baseUrl,
    accountId: config.accountId as number,
    inboxId: config.inboxId as number,
    apiToken: config.apiToken as string,
    botToken: config.botToken as string,
    timeoutMs: config.timeoutMs,
    logger: deps.logger,
    fetch: deps.fetch,
  });
}
