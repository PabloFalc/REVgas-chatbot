import { describe, expect, it } from 'vitest';
import { RevgasValidationError } from '../shared/revgas.errors';
import { pagination, setupHttp } from '../testing/http.testing';
import { SalesHttp } from './sales.http';

const validSale = {
  location: 'Rua A',
  number: '10',
  neighborhood: 'Centro',
  city: 'Teresina',
  state_federation: 'PI',
  products: [{ product_id: 1, quantity: 1, value: 100 }],
  payments: [{ payment_type: 'PIX', value: 100 }],
};

describe('SalesHttp', () => {
  it('create: POST /sales injeta establishment_id e channel padrão', async () => {
    const { http, call } = setupHttp([{ body: { id: 9, status: 'OPEN' } }]);
    const sale = await new SalesHttp(http, 7).create(validSale);
    expect(sale.id).toBe(9);
    expect(call().method).toBe('POST');
    expect(call().url.pathname).toBe('/v1/sales');
    expect(call().body).toMatchObject({ ...validSale, establishment_id: 7, channel: 'WHATSAPP' });
  });

  it('create com entrada inválida lança antes de chamar fetch', async () => {
    const { http, fetchMock } = setupHttp([]);
    const promise = new SalesHttp(http, 7).create({ ...validSale, city: '', products: [] });
    await expect(promise).rejects.toBeInstanceOf(RevgasValidationError);
    const error = (await promise.catch(e => e)) as RevgasValidationError;
    expect(error.fields.map(f => f.field).sort()).toEqual(['city', 'products']);
    expect(error.fields.every(f => f.message.length > 0)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('get: GET /sales/{id}', async () => {
    const { http, call } = setupHttp([{ body: { id: 9, status: 'OPEN' } }]);
    await new SalesHttp(http, 7).get(9);
    expect(call().method).toBe('GET');
    expect(call().url.pathname).toBe('/v1/sales/9');
  });

  it('list: injeta establishment_id', async () => {
    const { http, call } = setupHttp([{ body: { data: [], pagination: pagination() } }]);
    await new SalesHttp(http, 7).list({ customer_id: 5 });
    const { url } = call();
    expect(url.pathname).toBe('/v1/sales');
    expect(url.searchParams.get('establishment_id')).toBe('7');
    expect(url.searchParams.get('customer_id')).toBe('5');
  });

  it('list traduz status WARNING para WARN na query', async () => {
    const { http, call } = setupHttp([{ body: { data: [], pagination: pagination() } }]);
    await new SalesHttp(http, 7).list({ status: 'WARNING' });
    expect(call().url.searchParams.get('status')).toBe('WARN');
  });

  it('cancel: PUT /sales/{id}/cancel com motivo', async () => {
    const { http, call } = setupHttp([
      { body: { id: 9, status: 'CANCEL' } },
      { body: { id: 9, status: 'CANCEL' } },
    ]);
    const sales = new SalesHttp(http, 7);
    await sales.cancel(9, 4);
    expect(call(0).method).toBe('PUT');
    expect(call(0).url.pathname).toBe('/v1/sales/9/cancel');
    expect(call(0).body).toEqual({ motive_cancel_sale_id: 4 });
    await sales.cancel(9);
    expect(call(1).body).toEqual({ motive_cancel_sale_id: null });
  });
});
