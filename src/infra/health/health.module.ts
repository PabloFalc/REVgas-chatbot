import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MemoryHealthService } from './services/memory.health';
import { HealthRegistryService } from './services/registry.service';

@Module({
  providers: [HealthService, HealthRegistryService, MemoryHealthService],
  controllers: [HealthController],
  exports: [HealthRegistryService],
})
export class HealthModule {}
