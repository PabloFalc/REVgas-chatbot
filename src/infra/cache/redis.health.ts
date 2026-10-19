import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { IHealthChecks } from '../health/contracts/health.interface';
import type { HealthCheckResult } from '../health/schemas/health.schemas';
import { HealthRegistryService } from '../health/services/registry.service';
import { REDIS } from './redis.client';

@Injectable()
export class RedisHealthService implements IHealthChecks {
  readonly name: string = 'cache';

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(HealthRegistryService) private readonly registry: HealthRegistryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async check(): Promise<HealthCheckResult> {
    const start = Date.now();
    const key = `health:cache:${Date.now()}`;
    const timeout = 200;

    try {
      await Promise.race([
        (async () => {
          await this.redis.set(key, 'ok', 'EX', 5);

          const value = await this.redis.get(key);

          if (value !== 'ok') {
            throw new Error('Redis read/write validation failed');
          }
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), timeout)),
      ]);

      return {
        status: 'ok',
        responseTime: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Redis health check failed';

      return {
        status: 'error',
        responseTime: Date.now() - start,
        error: message,
      };
    }
  }
}
