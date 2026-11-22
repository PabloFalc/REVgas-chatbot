import { Module } from '@nestjs/common';
import { env } from '../../config/env';
import { resolveViacepConfig } from './shared/viacep.config';
import { VIACEP_CLIENT } from './viacep.client';
import { createViacepClient } from './viacep.factory';

@Module({
  providers: [
    {
      provide: VIACEP_CLIENT,
      useFactory: () => createViacepClient(resolveViacepConfig(env)),
    },
  ],
  exports: [VIACEP_CLIENT],
})
export class ViacepModule {}
