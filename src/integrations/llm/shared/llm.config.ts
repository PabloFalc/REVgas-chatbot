import type { Env } from '../../../config/env';

export type LlmMode = 'live' | 'fake';

export interface LlmConfig {
  mode: LlmMode;
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
}

export function resolveLlmConfig(env: Env): LlmConfig {
  const mode: LlmMode = env.LLM_MODE ?? (env.LLM_API_KEY ? 'live' : 'fake');

  if (mode === 'live' && !env.LLM_API_KEY) {
    throw new Error('LLM_API_KEY obrigatório com LLM_MODE=live');
  }

  return {
    mode,
    baseUrl: env.LLM_API_URL.replace(/\/+$/, ''),
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
    timeoutMs: env.LLM_TIMEOUT_MS,
  };
}
