import { describe, expect, it, vi } from 'vitest';
import { FakeRevgasClient } from './fake/fake-revgas.client';
import { HttpRevgasClient } from './http/http-revgas.client';
import { HybridRevgasClient } from './hybrid-revgas.client';
import type { RevgasConfig } from './revgas.config';
import { createRevgasClient } from './revgas.factory';

const config = (overrides: Partial<RevgasConfig> = {}): RevgasConfig => ({
  mode: 'fake',
  baseUrl: 'https://api.example.test/v1',
  apiKey: 'chave-de-teste',
  establishmentId: 1,
  timeoutMs: 1000,
  minIntervalMs: 0,
  ...overrides,
});

const logger = () => ({ info: vi.fn(), warn: vi.fn() });
const stubFetch = vi.fn() as unknown as typeof fetch;

describe('createRevgasClient', () => {
  it('mode fake → FakeRevgasClient', () => {
    expect(createRevgasClient(config())).toBeInstanceOf(FakeRevgasClient);
  });

  it('mode hybrid → HybridRevgasClient', () => {
    const client = createRevgasClient(config({ mode: 'hybrid' }), { fetch: stubFetch });
    expect(client).toBeInstanceOf(HybridRevgasClient);
  });

  it('mode live → HttpRevgasClient', () => {
    const client = createRevgasClient(config({ mode: 'live' }), { fetch: stubFetch });
    expect(client).toBeInstanceOf(HttpRevgasClient);
  });

  it('avisa no log quando nodeEnv é production e mode não é live', () => {
    const log = logger();
    createRevgasClient(config({ mode: 'hybrid' }), {
      logger: log,
      fetch: stubFetch,
      nodeEnv: 'production',
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('avisa em production com mode fake', () => {
    const log = logger();
    createRevgasClient(config(), { logger: log, nodeEnv: 'production' });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('não avisa em production com mode live nem fora de production', () => {
    const log = logger();
    createRevgasClient(config({ mode: 'live' }), {
      logger: log,
      fetch: stubFetch,
      nodeEnv: 'production',
    });
    createRevgasClient(config(), { logger: log, nodeEnv: 'development' });
    expect(log.warn).not.toHaveBeenCalled();
  });
});
