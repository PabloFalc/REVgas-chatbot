import { FakeLlmClient } from './fake-llm.client';
import type { LlmClient, LlmLogger } from './llm.client';
import { OpenAiCompatibleLlmClient } from './openai-compatible-llm.client';
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
