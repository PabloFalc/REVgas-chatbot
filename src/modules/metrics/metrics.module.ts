import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/infra/database/database.module';
import { BotEventsRepository } from './bot-events.repository';
import { MetricsRetention } from './metrics-retention';

@Module({
  imports: [DatabaseModule],
  providers: [BotEventsRepository, MetricsRetention],
  exports: [BotEventsRepository],
})
export class MetricsModule {}
