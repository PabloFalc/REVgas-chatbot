import { Module } from '@nestjs/common';
import { env } from '../../config/env';
import { createLogger } from '../../config/plugins/pino.config';
import { resolveWhatsappConfig } from './shared/whatsapp.config';
import { WHATSAPP_WEBHOOK } from './webhook/whatsapp-webhook';
import { WHATSAPP_CLIENT } from './whatsapp.client';
import { createWhatsappClient, createWhatsappWebhook } from './whatsapp.factory';

const config = () => resolveWhatsappConfig(env);

@Module({
  providers: [
    {
      provide: WHATSAPP_CLIENT,
      useFactory: () =>
        createWhatsappClient(config(), {
          logger: createLogger('WhatsappClient'),
          nodeEnv: env.NODE_ENV,
        }),
    },
    {
      provide: WHATSAPP_WEBHOOK,
      useFactory: () => createWhatsappWebhook(config()),
    },
  ],
  exports: [WHATSAPP_CLIENT, WHATSAPP_WEBHOOK],
})
export class WhatsappModule {}
