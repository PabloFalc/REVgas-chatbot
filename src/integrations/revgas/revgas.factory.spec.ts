import { describe, expect, it, vi } from 'vitest';
import { CustomersFake } from './customers/customers.fake';
import { CustomersHttp } from './customers/customers.http';
import { FakeRevgasClient } from './fake-revgas.client';
import { HybridRevgasClient } from './hybrid-revgas.client';
import { ProductsHttp } from './products/products.http';
import { createRevgasClient } from './revgas.factory';
import { SalesHttp } from './sales/sales.http';
import type { RevgasConfig } from './shared/revgas.config';

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
    expect(client.products).toBeInstanceOf(ProductsHttp);
    expect(client.customers).toBeInstanceOf(CustomersFake);
  });

  it('mode live → cliente HTTP agrupado por módulo', () => {
    const client = createRevgasClient(config({ mode: 'live' }), { fetch: stubFetch });
    expect(client).not.toBeInstanceOf(FakeRevgasClient);
    expect(client).not.toBeInstanceOf(HybridRevgasClient);
    expect(client.sales).toBeInstanceOf(SalesHttp);
    expect(client.customers).toBeInstanceOf(CustomersHttp);
    expect(Object.keys(client).sort()).toEqual([
      'customers',
      'deals',
      'establishments',
      'paymentTypes',
      'products',
      'sales',
    ]);
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
