import { describe, expect, it } from 'vitest';
import { pagination, setupHttp } from '../shared/revgas-http.testing';
import { DealsHttp } from './deals.http';

const deal = (id: number) => ({
  id,
  product_id: 1,
  suggested_value: 10,
  minimum_value: 5,
  payment_type: 'PIX',
});

describe('DealsHttp', () => {
  it('list: injeta establishment_id', async () => {
    const { http, call } = setupHttp([{ body: { data: [], pagination: pagination() } }]);
    await new DealsHttp(http, 7).list({ product_id: 3 });
    const { url } = call();
    expect(url.pathname).toBe('/v1/deals');
    expect(url.searchParams.get('establishment_id')).toBe('7');
    expect(url.searchParams.get('product_id')).toBe('3');
  });

  it('listAll junta 3 páginas', async () => {
    const { http, call, fetchMock } = setupHttp([
      { body: { data: [deal(1)], pagination: pagination({ page: 1, has_next: true }) } },
      { body: { data: [deal(2)], pagination: pagination({ page: 2, has_next: true }) } },
      { body: { data: [deal(3)], pagination: pagination({ page: 3, has_next: false }) } },
    ]);
    const deals = await new DealsHttp(http, 7).listAll();
    expect(deals.map(d => d.id)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(call(0).url.searchParams.get('page_size')).toBe('100');
    expect(call(2).url.searchParams.get('page')).toBe('3');
  });

  it('listAll usa total_count quando has_next está ausente', async () => {
    const { http, fetchMock } = setupHttp([
      { body: { data: [deal(1)], pagination: pagination({ page: 1, total_count: 150 }) } },
      { body: { data: [deal(2)], pagination: pagination({ page: 2, total_count: 150 }) } },
    ]);
    const deals = await new DealsHttp(http, 7).listAll();
    expect(deals).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
