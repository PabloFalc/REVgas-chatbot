import { Module } from '@nestjs/common';
import { env } from '../../config/env';
import { createLogger } from '../../config/plugins/pino.config';
import { CHATWOOT_CLIENT } from './chatwoot.client';
import { createChatwootClient } from './chatwoot.factory';
import { CHATWOOT_CONFIG, resolveChatwootConfig } from './shared/chatwoot.config';
import { CHATWOOT_WEBHOOK, ChatwootWebhook } from './webhook/chatwoot-webhook';

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
    {
      provide: CHATWOOT_WEBHOOK,
      inject: [CHATWOOT_CONFIG],
      useFactory: (config: ReturnType<typeof resolveChatwootConfig>) => new ChatwootWebhook(config),
    },
  ],
  exports: [CHATWOOT_CLIENT, CHATWOOT_CONFIG, CHATWOOT_WEBHOOK],
})
export class ChatwootModule {}
