import { env } from 'src/config/env';
import type { HealthResult } from './schemas/health.schemas';

export function publicHealth(
  result: HealthResult,
  isProduction = env.NODE_ENV === 'production',
): HealthResult {
  if (!isProduction) return result;

  const { checks: _checks, ...rest } = result;
  return rest;
}
