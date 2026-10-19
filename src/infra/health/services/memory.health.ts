import { Inject, Injectable } from '@nestjs/common';
import type { IHealthChecks } from '../contracts/health.interface';
import type { HealthCheckResult } from '../schemas/health.schemas';
import { HealthRegistryService } from './registry.service';

@Injectable()
export class MemoryHealthService implements IHealthChecks {
  readonly name: string = 'Memory';

  constructor(@Inject(HealthRegistryService) private readonly registry: HealthRegistryService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  check(): HealthCheckResult {
    const start = Date.now();

    try {
      const memory = process.memoryUsage();

      const usage = memory.heapUsed / memory.heapTotal;

      let status: 'ok' | 'warning' | 'error';

      if (usage < 0.7) {
        status = 'ok';
      } else if (usage <= 0.9) {
        status = 'warning';
      } else {
        status = 'error';
      }

      return {
        status,
        responseTime: Date.now() - start,
        details: {
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          rss: memory.rss,
          usage: Number((usage * 100).toFixed(2)),
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'memory check failed';

      return {
        status: 'error',
        responseTime: Date.now() - start,
        error: message,
      };
    }
  }
}
