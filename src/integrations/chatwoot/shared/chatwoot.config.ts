import type { Env } from '../../../config/env';

export type ChatwootMode = 'live' | 'fake' | 'off';

export interface ChatwootConfig {
  mode: ChatwootMode;
  baseUrl: string;
  accountId?: number;
  inboxId?: number;
  apiToken?: string;
  botToken?: string;
  webhookSecret?: string;
  timeoutMs: number;
}

export const CHATWOOT_CONFIG = Symbol('CHATWOOT_CONFIG');

const LIVE_REQUIRED = [
  'CHATWOOT_ACCOUNT_ID',
  'CHATWOOT_INBOX_ID',
  'CHATWOOT_API_TOKEN',
  'CHATWOOT_BOT_TOKEN',
  'CHATWOOT_WEBHOOK_SECRET',
] as const;

export function resolveChatwootConfig(env: Env): ChatwootConfig {
  const mode: ChatwootMode = env.CHATWOOT_MODE ?? (env.CHATWOOT_API_TOKEN ? 'live' : 'off');

  if (mode === 'live') {
    const missing = LIVE_REQUIRED.filter(key => !env[key]);
    if (missing.length > 0) {
      throw new Error(`${missing.join(', ')} obrigatório(s) com CHATWOOT_MODE=live`);
    }
  }

  return {
    mode,
    baseUrl: env.CHATWOOT_URL.replace(/\/+$/, ''),
    accountId: env.CHATWOOT_ACCOUNT_ID,
    inboxId: env.CHATWOOT_INBOX_ID ?? (mode === 'fake' ? 1 : undefined),
    apiToken: env.CHATWOOT_API_TOKEN,
    botToken: env.CHATWOOT_BOT_TOKEN,
    webhookSecret: env.CHATWOOT_WEBHOOK_SECRET,
    timeoutMs: env.CHATWOOT_TIMEOUT_MS,
  };
}
