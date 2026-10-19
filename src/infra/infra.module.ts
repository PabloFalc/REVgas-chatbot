import { Module } from '@nestjs/common';

import { CacheModule } from './cache/cache.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [CacheModule, DatabaseModule, HealthModule],
})
export class InfraModule {}
