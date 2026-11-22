import { Module } from '@nestjs/common';
import { env } from '../../config/env';
import { createLogger } from '../../config/plugins/pino.config';
import { REVGAS_CLIENT } from './revgas.client';
import { createRevgasClient } from './revgas.factory';
import { resolveRevgasConfig } from './shared/revgas.config';

@Module({
  providers: [
    {
      provide: REVGAS_CLIENT,
      useFactory: () =>
        createRevgasClient(resolveRevgasConfig(env), {
          logger: createLogger('RevgasClient'),
          nodeEnv: env.NODE_ENV,
        }),
    },
  ],
  exports: [REVGAS_CLIENT],
})
export class RevgasModule {}
