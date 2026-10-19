import { publicHealth } from './health.public';
import type { HealthResult } from './schemas/health.schemas';

const full: HealthResult = {
  status: 'ok',
  timestamp: '2026-06-17T00:00:00.000Z',
  uptime: 10,
  checks: {
    database: { status: 'ok', responseTime: 5 },
    redis: { status: 'ok', responseTime: 2 },
  },
};

describe('publicHealth', () => {
  it('remove checks em produção', () => {
    const result = publicHealth(full, true);

    expect(result.checks).toBeUndefined();
    expect(result).toEqual({ status: 'ok', timestamp: full.timestamp, uptime: 10 });
  });

  it('mantém checks fora de produção', () => {
    const result = publicHealth(full, false);

    expect(result.checks).toEqual(full.checks);
  });
});
