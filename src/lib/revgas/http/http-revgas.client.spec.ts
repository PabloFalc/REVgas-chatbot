import { describe, expect, it, vi } from 'vitest';
import { RevgasValidationError } from '../revgas.errors';
import { HttpRevgasClient } from './http-revgas.client';
import { RevgasHttp } from './revgas-http';

const silentLogger = { info: () => undefined, warn: () => undefined };

const pagination = (over: Record<string, unknown> = {}) => ({
  page: 1,
  count: 1,
  total_count: 1,
  ...over,
});

const validSale = {
  location: 'Rua A',
  number: '10',
  neighborhood: 'Centro',
  city: 'Teresina',
  state_federation: 'PI',
  products: [{ product_id: 1, quantity: 1, value: 100 }],
  payments: [{ payment_type: 'PIX', value: 100 }],
};

function setup(responses: Array<{ body: unknown; status?: number }>) {
  const queue = [...responses];
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  });
  const http = new RevgasHttp({
    baseUrl: 'https://api.test/v1',
    apiKey: 'key',
    timeoutMs: 1000,
    minIntervalMs: 0,
    logger: silentLogger,
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  const client = new HttpRevgasClient(http, 7);
  const call = (index = 0) => {
    const [url, init] = fetchMock.mock.calls[index];
    return {
      url: new URL(String(url)),
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
  };
  return { client, fetchMock, call };
}

describe('HttpRevgasClient', () => {
  it('listEstablishments: GET /establishments', async () => {
    const { client, call } = setup([{ body: { data: [{ id: 7 }], pagination: pagination() } }]);
    const page = await client.listEstablishments();
    expect(page.data[0].id).toBe(7);
    expect(call().method).toBe('GET');
    expect(call().url.pathname).toBe('/v1/establishments');
  });

  it('listProducts: injeta establishment_id e inactive=false', async () => {
    const { client, call } = setup([{ body: { data: [], pagination: pagination() } }]);
    await client.listProducts({ description: 'gas' });
    const { url, method } = call();
    expect(method).toBe('GET');
    expect(url.pathname).toBe('/v1/products');
    expect(url.searchParams.get('establishment_id')).toBe('7');
    expect(url.searchParams.get('inactive')).toBe('false');
    expect(url.searchParams.get('description')).toBe('gas');
  });

  it('listDeals: injeta establishment_id', async () => {
    const { client, call } = setup([{ body: { data: [], pagination: pagination() } }]);
    await client.listDeals({ product_id: 3 });
    const { url } = call();
    expect(url.pathname).toBe('/v1/deals');
    expect(url.searchParams.get('establishment_id')).toBe('7');
    expect(url.searchParams.get('product_id')).toBe('3');
  });

  it('listAllDeals junta 3 páginas', async () => {
    const deal = (id: number) => ({
      id,
      product_id: 1,
      suggested_value: 10,
      minimum_value: 5,
      payment_type: 'PIX',
    });
    const { client, call, fetchMock } = setup([
      { body: { data: [deal(1)], pagination: pagination({ page: 1, has_next: true }) } },
      { body: { data: [deal(2)], pagination: pagination({ page: 2, has_next: true }) } },
      { body: { data: [deal(3)], pagination: pagination({ page: 3, has_next: false }) } },
    ]);
    const deals = await client.listAllDeals();
    expect(deals.map(d => d.id)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(call(0).url.searchParams.get('page_size')).toBe('100');
    expect(call(2).url.searchParams.get('page')).toBe('3');
  });

  it('listAllDeals usa total_count quando has_next está ausente', async () => {
    const deal = (id: number) => ({
      id,
      product_id: 1,
      suggested_value: 10,
      minimum_value: 5,
      payment_type: 'PIX',
    });
    const { client, fetchMock } = setup([
      { body: { data: [deal(1)], pagination: pagination({ page: 1, total_count: 150 }) } },
      { body: { data: [deal(2)], pagination: pagination({ page: 2, total_count: 150 }) } },
    ]);
    const deals = await client.listAllDeals();
    expect(deals).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('listPaymentTypes: filtra ACTIVE e devolve data', async () => {
    const { client, call } = setup([
      { body: { data: [{ id: 1, payment_type: 'PIX' }], pagination: pagination() } },
    ]);
    const types = await client.listPaymentTypes();
    expect(types).toHaveLength(1);
    const { url } = call();
    expect(url.pathname).toBe('/v1/payment-types');
    expect(url.searchParams.get('establishment_id')).toBe('7');
    expect(url.searchParams.get('status')).toBe('ACTIVE');
    expect(url.searchParams.get('page_size')).toBe('100');
  });

  it('findCustomersByPhone normaliza para dígitos e devolve data', async () => {
    const { client, call } = setup([{ body: { data: [{ id: 5 }], pagination: pagination() } }]);
    const customers = await client.findCustomersByPhone('+55 (86) 99999-8888');
    expect(customers[0].id).toBe(5);
    const { url } = call();
    expect(url.pathname).toBe('/v1/customers');
    expect(url.searchParams.get('phone')).toBe('5586999998888');
  });

  it('getCustomer: GET /customers/{id}', async () => {
    const { client, call } = setup([{ body: { id: 5 } }]);
    await client.getCustomer(5);
    expect(call().method).toBe('GET');
    expect(call().url.pathname).toBe('/v1/customers/5');
  });

  it('updateCustomer: PUT /customers/{id} com corpo', async () => {
    const { client, call } = setup([{ body: { id: 5 } }]);
    await client.updateCustomer(5, { name: 'Fulano' });
    expect(call().method).toBe('PUT');
    expect(call().url.pathname).toBe('/v1/customers/5');
    expect(call().body).toEqual({ name: 'Fulano' });
  });

  it('createCustomer: POST /customers com corpo', async () => {
    const { client, call } = setup([{ body: { id: 6 } }]);
    await client.createCustomer({ name: 'Fulano', phones: ['5586999998888'] });
    expect(call().method).toBe('POST');
    expect(call().url.pathname).toBe('/v1/customers');
    expect(call().body).toEqual({ name: 'Fulano', phones: ['5586999998888'] });
  });

  it('createSale: POST /sales injeta establishment_id e channel padrão', async () => {
    const { client, call } = setup([{ body: { id: 9, status: 'OPEN' } }]);
    const sale = await client.createSale(validSale);
    expect(sale.id).toBe(9);
    expect(call().method).toBe('POST');
    expect(call().url.pathname).toBe('/v1/sales');
    expect(call().body).toMatchObject({ ...validSale, establishment_id: 7, channel: 'WHATSAPP' });
  });

  it('createSale com entrada inválida lança antes de chamar fetch', async () => {
    const { client, fetchMock } = setup([]);
    const promise = client.createSale({ ...validSale, city: '', products: [] });
    await expect(promise).rejects.toBeInstanceOf(RevgasValidationError);
    const error = (await promise.catch(e => e)) as RevgasValidationError;
    expect(error.fields.map(f => f.field).sort()).toEqual(['city', 'products']);
    expect(error.fields.every(f => f.message.length > 0)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getSale: GET /sales/{id}', async () => {
    const { client, call } = setup([{ body: { id: 9, status: 'OPEN' } }]);
    await client.getSale(9);
    expect(call().method).toBe('GET');
    expect(call().url.pathname).toBe('/v1/sales/9');
  });

  it('listSales: injeta establishment_id', async () => {
    const { client, call } = setup([{ body: { data: [], pagination: pagination() } }]);
    await client.listSales({ customer_id: 5 });
    const { url } = call();
    expect(url.pathname).toBe('/v1/sales');
    expect(url.searchParams.get('establishment_id')).toBe('7');
    expect(url.searchParams.get('customer_id')).toBe('5');
  });

  it('cancelSale: PUT /sales/{id}/cancel com motivo', async () => {
    const { client, call } = setup([
      { body: { id: 9, status: 'CANCEL' } },
      { body: { id: 9, status: 'CANCEL' } },
    ]);
    await client.cancelSale(9, 4);
    expect(call(0).method).toBe('PUT');
    expect(call(0).url.pathname).toBe('/v1/sales/9/cancel');
    expect(call(0).body).toEqual({ motive_cancel_sale_id: 4 });
    await client.cancelSale(9);
    expect(call(1).body).toEqual({ motive_cancel_sale_id: null });
  });
});
