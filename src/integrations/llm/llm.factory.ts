import type { EmbeddingClient } from './embedding.client';
import { FakeEmbeddingClient } from './fake-embedding.client';
import { FakeLlmClient } from './fake-llm.client';
import type { LlmClient, LlmLogger } from './llm.client';
import { OpenAiCompatibleEmbeddingClient } from './openai-compatible-embedding.client';
import { OpenAiCompatibleLlmClient } from './openai-compatible-llm.client';
import type { EmbeddingConfig } from './shared/embedding.config';
import type { LlmConfig } from './shared/llm.config';

export type CreateLlmDeps = {
  logger?: LlmLogger;
  fetch?: typeof fetch;
  nodeEnv?: string;
};

const noopLogger: LlmLogger = { info: () => undefined, warn: () => undefined };

export function createLlmClient(config: LlmConfig, deps: CreateLlmDeps = {}): LlmClient {
  const logger = deps.logger ?? noopLogger;

  if (config.mode === 'fake') {
    if (deps.nodeEnv === 'production') {
      logger.warn(
        { mode: config.mode },
        'Cliente LLM simulado em produção (LLM_MODE=fake): a IA fica desligada e o bot usa só botões',
      );
    }
    return new FakeLlmClient();
  }

  return new OpenAiCompatibleLlmClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey as string,
    model: config.model,
    timeoutMs: config.timeoutMs,
    logger,
    fetch: deps.fetch,
  });
}

export function createEmbeddingClient(
  config: EmbeddingConfig,
  deps: CreateLlmDeps = {},
): EmbeddingClient {
  const logger = deps.logger ?? noopLogger;

  if (config.mode === 'fake') {
    if (deps.nodeEnv === 'production') {
      logger.warn(
        { mode: config.mode },
        'Cliente de embedding simulado em produção (LLM_MODE=fake): a busca na base de conhecimento fica desligada',
      );
    }
    return new FakeEmbeddingClient({ dimensions: config.dimensions, model: config.model });
  }

  return new OpenAiCompatibleEmbeddingClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey as string,
    model: config.model,
    dimensions: config.dimensions,
    batchSize: config.batchSize,
    timeoutMs: config.timeoutMs,
    logger,
    fetch: deps.fetch,
  });
}
