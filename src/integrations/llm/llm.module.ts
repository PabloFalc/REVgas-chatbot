import { Module } from '@nestjs/common';
import { env } from '../../config/env';
import { createLogger } from '../../config/plugins/pino.config';
import { LLM_CLIENT } from './llm.client';
import { createLlmClient } from './llm.factory';
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
  ],
  exports: [LLM_CLIENT],
})
export class LlmModule {}
