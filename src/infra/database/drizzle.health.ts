import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { IHealthChecks } from 'src/infra/health/contracts/health.interface';
import type { HealthCheckResult } from 'src/infra/health/schemas/health.schemas';
import { HealthRegistryService } from '../health/services/registry.service';
import { DRIZZLE } from './drizzle-client';
import type * as schema from './schemas/index';

const TIMEOUT_MS = 2_000;

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
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.db.execute(sql`SELECT 1`),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Database timeout')), TIMEOUT_MS);
        }),
      ]);
      return {
        status: 'ok',
        responseTime: Date.now() - start,
      };
    } catch (error: unknown) {
      const timedOut = error instanceof Error && error.message === 'Database timeout';

      return {
        status: 'error',
        responseTime: Date.now() - start,
        error: timedOut ? 'Database timeout' : 'Database unavailable',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
