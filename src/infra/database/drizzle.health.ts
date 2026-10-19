import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { IHealthChecks } from 'src/infra/health/contracts/health.interface';
import type { HealthCheckResult } from 'src/infra/health/schemas/health.schemas';
import { HealthRegistryService } from '../health/services/registry.service';
import { DRIZZLE } from './drizzle-client';
import type * as schema from './schemas/index';

@Injectable()
export class DrizzleHealthService implements IHealthChecks {
  readonly name: string = 'database';

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(HealthRegistryService) private readonly registry: HealthRegistryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async check(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await this.db.execute(sql`SELECT 1`);
      return {
        status: 'ok',
        responseTime: Date.now() - start,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Database halth check failed';

      return {
        status: 'error',
        responseTime: 0,
        error: message,
      };
    }
  }
}
