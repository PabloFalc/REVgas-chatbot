import type { HealthResult } from 'src/infra/health/schemas/health.schemas';
import { ServiceUnavailableError } from './http.errors';

export class HealthCheckError extends ServiceUnavailableError {
  constructor(public readonly result: HealthResult) {
    super({
      message: 'Health check',
      details: result,
    });
  }
}
