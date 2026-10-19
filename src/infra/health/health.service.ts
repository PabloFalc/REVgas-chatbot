import { Inject, Injectable } from '@nestjs/common';
import { HealthCheckError } from 'src/core/erros/health.error';
import { publicHealth } from './health.public';
import type { HealthCheckResult, HealthResult } from './schemas/health.schemas';
import { HealthRegistryService } from './services/registry.service';

@Injectable()
export class HealthService {
  private readonly serverStartTime = Date.now();

  constructor(@Inject(HealthRegistryService) private readonly registry: HealthRegistryService) {}

  private getChecks() {
    return this.registry.getChecks();
  }

  async check(): Promise<HealthResult> {
    const checkList = this.getChecks();

    const checkEntries = await Promise.allSettled(
      checkList.map(async check => {
        const result = await check.check();
        return [check.name, result] as const;
      }),
    );

    const checks: Record<string, HealthCheckResult> = Object.fromEntries(
      checkEntries.map((entry, index) => {
        if (entry.status === 'fulfilled') return entry.value;

        return [
          checkList[index]?.name ?? 'unknown',
          { status: 'error', error: String(entry.reason) },
        ] as const;
      }),
    );

    let globalStatus: 'ok' | 'unavailable' | 'degraded' = 'ok';

    const dbStatus = checks.database?.status ?? 'error';

    if (dbStatus !== 'ok') {
      globalStatus = 'unavailable';
    } else {
      const hasSecondaryFailures = Object.entries(checks).some(
        ([name, result]) => name !== 'database' && result.status !== 'ok',
      );

      if (hasSecondaryFailures) {
        globalStatus = 'degraded';
      }
    }
    const uptime = Math.floor((Date.now() - this.serverStartTime) / 1000);

    const messageReturn: HealthResult = {
      status: globalStatus,
      timestamp: new Date().toISOString(),
      uptime,
      checks,
    };

    if (globalStatus === 'unavailable') {
      throw new HealthCheckError(publicHealth(messageReturn));
    }

    return messageReturn;
  }
}
