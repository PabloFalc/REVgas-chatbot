import { describe, expect, it } from 'vitest';
import { pagination, setupHttp } from '../shared/revgas-http.testing';
import { ProductsHttp } from './products.http';

describe('ProductsHttp', () => {
  it('list: injeta establishment_id e inactive=false', async () => {
    const { http, call } = setupHttp([{ body: { data: [], pagination: pagination() } }]);
    await new ProductsHttp(http, 7).list({ description: 'gas' });
    const { url, method } = call();
    expect(method).toBe('GET');
    expect(url.pathname).toBe('/v1/products');
    expect(url.searchParams.get('establishment_id')).toBe('7');
    expect(url.searchParams.get('inactive')).toBe('false');
    expect(url.searchParams.get('description')).toBe('gas');
  });
});
