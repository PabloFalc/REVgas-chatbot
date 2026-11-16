import type { Env } from '../../../config/env';
import type { LlmMode } from './llm.config';

export interface EmbeddingConfig {
  mode: LlmMode;
  baseUrl: string;
  apiKey?: string;
  model: string;
  dimensions: number;
  batchSize: number;
  timeoutMs: number;
}

export function resolveEmbeddingConfig(env: Env): EmbeddingConfig {
  const apiKey = env.EMBEDDING_API_KEY ?? env.LLM_API_KEY;
  const mode: LlmMode = env.LLM_MODE ?? (apiKey ? 'live' : 'fake');

  if (mode === 'live' && !apiKey) {
    throw new Error('EMBEDDING_API_KEY ou LLM_API_KEY obrigatório com LLM_MODE=live');
  }

  return {
    mode,
    baseUrl: (env.EMBEDDING_API_URL ?? env.LLM_API_URL).replace(/\/+$/, ''),
    apiKey,
    model: env.EMBEDDING_MODEL,
    dimensions: env.EMBEDDING_DIMENSIONS,
    batchSize: env.EMBEDDING_BATCH_SIZE,
    timeoutMs: env.LLM_TIMEOUT_MS,
  };
}
