import type { OnModuleInit } from '@nestjs/common';
import type { HealthCheckResult } from '../schemas/health.schemas';

export abstract class IHealthChecks implements OnModuleInit {
  abstract readonly name: string;
  abstract check(): HealthCheckResult | Promise<HealthCheckResult>;
  onModuleInit() {
    throw new Error('This method should be implemented.');
  }
}
