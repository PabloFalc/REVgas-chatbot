import { describe, expect, it } from 'vitest';
import { pagination, setupHttp } from '../shared/revgas-http.testing';
import { CustomersHttp } from './customers.http';

describe('CustomersHttp', () => {
  it('findByPhone normaliza para dígitos e devolve data', async () => {
    const { http, call } = setupHttp([{ body: { data: [{ id: 5 }], pagination: pagination() } }]);
    const customers = await new CustomersHttp(http).findByPhone('+55 (86) 99999-8888');
    expect(customers[0].id).toBe(5);
    const { url } = call();
    expect(url.pathname).toBe('/v1/customers');
    expect(url.searchParams.get('phone')).toBe('5586999998888');
  });

  it('findByPhone com telefone curto ou vazio não chama a API', async () => {
    const { http, fetchMock } = setupHttp([]);
    const customers = new CustomersHttp(http);
    for (const phone of ['', 'abc', '+', '88', '123456789', '12345678901234']) {
      expect(await customers.findByPhone(phone)).toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('get: GET /customers/{id}', async () => {
    const { http, call } = setupHttp([{ body: { id: 5 } }]);
    await new CustomersHttp(http).get(5);
    expect(call().method).toBe('GET');
    expect(call().url.pathname).toBe('/v1/customers/5');
  });

  it('update: PUT /customers/{id} com corpo', async () => {
    const { http, call } = setupHttp([{ body: { id: 5 } }]);
    await new CustomersHttp(http).update(5, { name: 'Fulano' });
    expect(call().method).toBe('PUT');
    expect(call().url.pathname).toBe('/v1/customers/5');
    expect(call().body).toEqual({ name: 'Fulano' });
  });

  it('create: POST /customers com corpo', async () => {
    const { http, call } = setupHttp([{ body: { id: 6 } }]);
    await new CustomersHttp(http).create({ name: 'Fulano', phones: ['5586999998888'] });
    expect(call().method).toBe('POST');
    expect(call().url.pathname).toBe('/v1/customers');
    expect(call().body).toEqual({ name: 'Fulano', phones: ['5586999998888'] });
  });
});
