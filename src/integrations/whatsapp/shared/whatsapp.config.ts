import type { Env } from '../../../config/env';

export type WhatsappMode = 'live' | 'fake';

export interface WhatsappConfig {
  mode: WhatsappMode;
  baseUrl: string;
  apiVersion: string;
  accessToken?: string;
  phoneNumberId?: string;
  appSecret?: string;
  verifyToken?: string;
  timeoutMs: number;
}

const LIVE_REQUIRED = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
] as const;

const PRODUCTION_REQUIRED = ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'] as const;

export function resolveWhatsappConfig(env: Env): WhatsappConfig {
  const mode: WhatsappMode = env.WHATSAPP_MODE ?? (env.WHATSAPP_ACCESS_TOKEN ? 'live' : 'fake');

  if (mode === 'live') {
    const missing = LIVE_REQUIRED.filter(key => !env[key]);
    if (missing.length > 0) {
      throw new Error(`${missing.join(', ')} obrigatório(s) com WHATSAPP_MODE=live`);
    }
  }

  if (env.NODE_ENV === 'production') {
    const missing = PRODUCTION_REQUIRED.filter(key => !env[key]);
    if (missing.length > 0) {
      throw new Error(`${missing.join(', ')} obrigatório(s) em produção, mesmo em fake`);
    }
  }

  return {
    mode,
    baseUrl: env.WHATSAPP_API_URL,
    apiVersion: env.WHATSAPP_API_VERSION,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    appSecret: env.WHATSAPP_APP_SECRET,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    timeoutMs: env.WHATSAPP_TIMEOUT_MS,
  };
}
