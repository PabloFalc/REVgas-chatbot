import { Module } from '@nestjs/common';
import { env } from '../../config/env';
import { createLogger } from '../../config/plugins/pino.config';
import { CHATWOOT_CLIENT } from './chatwoot.client';
import { createChatwootClient } from './chatwoot.factory';
import { CHATWOOT_CONFIG, resolveChatwootConfig } from './shared/chatwoot.config';

@Module({
  providers: [
    {
      provide: CHATWOOT_CONFIG,
      useFactory: () => resolveChatwootConfig(env),
    },
    {
      provide: CHATWOOT_CLIENT,
      inject: [CHATWOOT_CONFIG],
      useFactory: (config: ReturnType<typeof resolveChatwootConfig>) =>
        createChatwootClient(config, { logger: createLogger('ChatwootClient') }),
    },
  ],
  exports: [CHATWOOT_CLIENT, CHATWOOT_CONFIG],
})
export class ChatwootModule {}
