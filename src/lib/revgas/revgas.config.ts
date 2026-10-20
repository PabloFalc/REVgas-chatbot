import type { Env } from '../../config/env';

export type RevgasMode = 'live' | 'hybrid' | 'fake';

export interface RevgasConfig {
  mode: RevgasMode;
  baseUrl: string;
  apiKey?: string;
  establishmentId?: number;
  timeoutMs: number;
  minIntervalMs: number;
}

export function resolveRevgasConfig(env: Env): RevgasConfig {
  const mode: RevgasMode = env.REVGAS_MODE ?? (env.REVGAS_API_KEY ? 'hybrid' : 'fake');

  if (mode !== 'fake') {
    if (!env.REVGAS_API_KEY) {
      throw new Error(`REVGAS_API_KEY é obrigatório com REVGAS_MODE=${mode}`);
    }
    if (env.REVGAS_ESTABLISHMENT_ID === undefined) {
      throw new Error(`REVGAS_ESTABLISHMENT_ID é obrigatório com REVGAS_MODE=${mode}`);
    }
  }

  return {
    mode,
    baseUrl: env.REVGAS_API_URL,
    apiKey: env.REVGAS_API_KEY,
    establishmentId: env.REVGAS_ESTABLISHMENT_ID,
    timeoutMs: env.REVGAS_TIMEOUT_MS,
    minIntervalMs: env.REVGAS_MIN_INTERVAL_MS,
  };
}
