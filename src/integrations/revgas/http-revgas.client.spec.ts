import { describe, expect, it } from 'vitest';
import { createHttpRevgasClient } from './http-revgas.client';
import { pagination, setupHttp } from './shared/revgas-http.testing';

describe('createHttpRevgasClient', () => {
  it('liga cada módulo ao establishment_id configurado', async () => {
    const { http, call } = setupHttp([
      { body: { data: [], pagination: pagination() } },
      { body: { data: [], pagination: pagination() } },
      { body: { data: [], pagination: pagination() } },
      { body: { data: [], pagination: pagination() } },
    ]);
    const client = createHttpRevgasClient(http, 7);
    await client.products.list();
    await client.deals.list();
    await client.paymentTypes.list();
    await client.sales.list();
    for (const index of [0, 1, 2, 3]) {
      expect(call(index).url.searchParams.get('establishment_id')).toBe('7');
    }
  });
});
