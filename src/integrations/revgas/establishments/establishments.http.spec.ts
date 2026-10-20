import { describe, expect, it } from 'vitest';
import { pagination, setupHttp } from '../testing/http.testing';
import { EstablishmentsHttp } from './establishments.http';

describe('EstablishmentsHttp', () => {
  it('list: GET /establishments', async () => {
    const { http, call } = setupHttp([{ body: { data: [{ id: 7 }], pagination: pagination() } }]);
    const page = await new EstablishmentsHttp(http).list();
    expect(page.data[0].id).toBe(7);
    expect(call().method).toBe('GET');
    expect(call().url.pathname).toBe('/v1/establishments');
  });
});
