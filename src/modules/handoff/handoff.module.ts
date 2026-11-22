import { Module } from '@nestjs/common';
import { env } from 'src/config/env';
import { CacheModule } from 'src/infra/cache/cache.module';
import { ChatwootModule } from 'src/integrations/chatwoot/chatwoot.module';
import { parseServiceHours } from 'src/utils/service-hours';
import { DeskGateway } from './desk.gateway';
import { HandoffRepository } from './handoff.repository';
import { HANDOFF_CLOCK, HandoffService, SERVICE_HOURS } from './handoff.service';

@Module({
  imports: [CacheModule, ChatwootModule],
  providers: [
    HandoffService,
    HandoffRepository,
    DeskGateway,
    { provide: HANDOFF_CLOCK, useValue: { now: () => new Date() } },
    { provide: SERVICE_HOURS, useFactory: () => parseServiceHours(env.SERVICE_HOURS ?? '') },
  ],
  exports: [HandoffService],
})
export class HandoffModule {}
