import { Module } from '@nestjs/common';
import { env } from '../../config/env';
import { createLogger } from '../../config/plugins/pino.config';
import { EMBEDDING_CLIENT } from './embedding.client';
import { LLM_CLIENT } from './llm.client';
import { createEmbeddingClient, createLlmClient } from './llm.factory';
import { resolveEmbeddingConfig } from './shared/embedding.config';
import { resolveLlmConfig } from './shared/llm.config';

@Module({
  providers: [
    {
      provide: LLM_CLIENT,
      useFactory: () =>
        createLlmClient(resolveLlmConfig(env), {
          logger: createLogger('LlmClient'),
          nodeEnv: env.NODE_ENV,
        }),
    },
    {
      provide: EMBEDDING_CLIENT,
      useFactory: () =>
        createEmbeddingClient(resolveEmbeddingConfig(env), {
          logger: createLogger('EmbeddingClient'),
          nodeEnv: env.NODE_ENV,
        }),
    },
  ],
  exports: [LLM_CLIENT, EMBEDDING_CLIENT],
})
export class LlmModule {}
