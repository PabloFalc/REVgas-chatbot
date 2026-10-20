import { describe, expect, it } from 'vitest';
import { pagination, setupHttp } from '../shared/revgas-http.testing';
import { PaymentTypesHttp } from './payment-types.http';

describe('PaymentTypesHttp', () => {
  it('list: filtra ACTIVE e devolve data', async () => {
    const { http, call } = setupHttp([
      { body: { data: [{ id: 1, payment_type: 'PIX' }], pagination: pagination() } },
    ]);
    const types = await new PaymentTypesHttp(http, 7).list();
    expect(types).toHaveLength(1);
    const { url } = call();
    expect(url.pathname).toBe('/v1/payment-types');
    expect(url.searchParams.get('establishment_id')).toBe('7');
    expect(url.searchParams.get('status')).toBe('ACTIVE');
    expect(url.searchParams.get('page_size')).toBe('100');
  });
});
