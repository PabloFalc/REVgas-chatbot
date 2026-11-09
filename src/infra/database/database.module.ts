import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { DrizzleHealthService } from './drizzle.health';
import { DrizzleService } from './drizzle.service';
import { DRIZZLE, drizzleClient } from './drizzle-client';

@Module({
  providers: [DrizzleService, drizzleClient, DrizzleHealthService],
  exports: [DrizzleService, DrizzleHealthService, DRIZZLE],
  imports: [HealthModule],
})
export class DatabaseModule {}
