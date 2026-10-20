import { describe, expect, it, vi } from 'vitest';
import { FakeRevgasClient } from './fake/fake-revgas.client';
import { FAKE_CUSTOMERS, FAKE_ID_START, FAKE_PRODUCTS } from './fake/fixtures';
import { HybridRevgasClient } from './hybrid-revgas.client';
import type { RevgasClient } from './revgas.client';

const methods = [
  'listEstablishments',
  'listProducts',
  'listDeals',
  'listAllDeals',
  'listPaymentTypes',
  'findCustomersByPhone',
  'getCustomer',
  'createCustomer',
  'updateCustomer',
  'createSale',
  'getSale',
  'listSales',
  'cancelSale',
] as const;

const stubLive = () =>
  Object.fromEntries(methods.map(name => [name, vi.fn().mockResolvedValue('live')])) as unknown as {
    [K in (typeof methods)[number]]: ReturnType<typeof vi.fn>;
  } & RevgasClient;

const saleInput = {
  location: 'Rua Exemplo',
  number: '10',
  neighborhood: 'Centro',
  city: 'Teresina',
  state_federation: 'PI',
  products: [{ product_id: FAKE_PRODUCTS[0].id, quantity: 1, value: 100 }],
  payments: [{ payment_type: 'PIX', value: 100 }],
};

describe('HybridRevgasClient', () => {
  it('leituras de catálogo vão para o live', async () => {
    const live = stubLive();
    const client = new HybridRevgasClient(live, new FakeRevgasClient());
    await client.listEstablishments();
    await client.listProducts({ page: 1 });
    await client.listDeals({ page: 1 });
    await client.listAllDeals();
    expect(live.listEstablishments).toHaveBeenCalledTimes(1);
    expect(live.listProducts).toHaveBeenCalledWith({ page: 1 });
    expect(live.listDeals).toHaveBeenCalledWith({ page: 1 });
    expect(live.listAllDeals).toHaveBeenCalledTimes(1);
  });

  it('clientes e escrita vão para o fake', async () => {
    const live = stubLive();
    const fake = new FakeRevgasClient();
    const client = new HybridRevgasClient(live, fake);
    const customerId = FAKE_CUSTOMERS[0].id;
    await client.listPaymentTypes();
    await client.findCustomersByPhone('86999990000');
    await client.getCustomer(customerId);
    const created = await client.createCustomer({
      name: 'Cliente Teste',
      phones: ['5586988887777'],
    });
    await client.updateCustomer(created.id, { name: 'Outro Nome', phones: ['5586988887777'] });
    const sale = await client.createSale(saleInput);
    await client.cancelSale(sale.id);
    for (const name of methods) {
      if (
        ['listEstablishments', 'listProducts', 'listDeals', 'listAllDeals', 'getSale'].includes(
          name,
        )
      ) {
        continue;
      }
      expect(live[name], name).not.toHaveBeenCalled();
    }
    expect(fake.ownsSale(sale.id)).toBe(true);
  });

  it('listPaymentTypes usa as deals do live quando o fake é construído com dealsSource', async () => {
    const live = stubLive();
    live.listAllDeals.mockResolvedValue([]);
    const fake = new FakeRevgasClient({ dealsSource: () => live.listAllDeals() });
    const client = new HybridRevgasClient(live, fake);
    await client.listPaymentTypes();
    expect(live.listAllDeals).toHaveBeenCalledTimes(1);
  });

  it('getSale de venda simulada vai ao fake; de venda real vai ao live', async () => {
    const live = stubLive();
    const fake = new FakeRevgasClient();
    const client = new HybridRevgasClient(live, fake);
    const sale = await client.createSale(saleInput);
    await client.getSale(sale.id);
    expect(live.getSale).not.toHaveBeenCalled();
    await client.getSale(5);
    expect(live.getSale).toHaveBeenCalledWith(5);
  });

  it('listSales de cliente simulado vai ao fake; sem customer_id vai ao live', async () => {
    const live = stubLive();
    const fake = new FakeRevgasClient();
    const client = new HybridRevgasClient(live, fake);
    const customer = await client.createCustomer({
      name: 'Cliente Teste',
      phones: ['5586988887777'],
    });
    expect(customer.id).toBeGreaterThanOrEqual(FAKE_ID_START);
    await client.listSales({ customer_id: customer.id });
    expect(live.listSales).not.toHaveBeenCalled();
    await client.listSales({});
    await client.listSales({ customer_id: 7 });
    expect(live.listSales).toHaveBeenCalledTimes(2);
  });
});
