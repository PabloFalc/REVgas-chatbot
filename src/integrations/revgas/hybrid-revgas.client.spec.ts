import { describe, expect, it, vi } from 'vitest';
import { FAKE_CUSTOMERS } from './customers/customers.fixtures';
import { FakeRevgasClient } from './fake-revgas.client';
import { HybridRevgasClient } from './hybrid-revgas.client';
import { FAKE_PRODUCTS } from './products/products.fixtures';
import type { RevgasClient } from './revgas.client';
import { FAKE_ID_START } from './shared/fake-id';

const stubModule = (names: string[]) =>
  Object.fromEntries(names.map(name => [name, vi.fn().mockResolvedValue('live')]));

const stubLive = () => {
  const live = {
    establishments: stubModule(['list']),
    products: stubModule(['list']),
    deals: stubModule(['list', 'listAll']),
    paymentTypes: stubModule(['list']),
    customers: stubModule(['findByPhone', 'get', 'create', 'update']),
    sales: stubModule(['create', 'get', 'list', 'cancel']),
  };
  return live as unknown as RevgasClient & {
    [K in keyof typeof live]: Record<string, ReturnType<typeof vi.fn>>;
  };
};

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
    await client.establishments.list();
    await client.products.list({ page: 1 });
    await client.deals.list({ page: 1 });
    await client.deals.listAll();
    expect(live.establishments.list).toHaveBeenCalledTimes(1);
    expect(live.products.list).toHaveBeenCalledWith({ page: 1 });
    expect(live.deals.list).toHaveBeenCalledWith({ page: 1 });
    expect(live.deals.listAll).toHaveBeenCalledTimes(1);
  });

  it('clientes e escrita vão para o fake', async () => {
    const live = stubLive();
    const fake = new FakeRevgasClient();
    const client = new HybridRevgasClient(live, fake);
    const customerId = FAKE_CUSTOMERS[0].id;
    await client.paymentTypes.list();
    await client.customers.findByPhone('86999990000');
    await client.customers.get(customerId);
    const created = await client.customers.create({
      name: 'Cliente Teste',
      phones: ['5586988887777'],
    });
    await client.customers.update(created.id, {
      name: 'Outro Nome',
      phones: ['5586988887777'],
    });
    const sale = await client.sales.create(saleInput);
    await client.sales.cancel(sale.id);
    expect(live.paymentTypes.list).not.toHaveBeenCalled();
    for (const name of Object.keys(live.customers)) {
      expect(live.customers[name], name).not.toHaveBeenCalled();
    }
    expect(live.sales.create).not.toHaveBeenCalled();
    expect(live.sales.cancel).not.toHaveBeenCalled();
    expect(fake.ownsSale(sale.id)).toBe(true);
  });

  it('paymentTypes.list usa as deals do live quando o fake é construído com dealsSource', async () => {
    const live = stubLive();
    vi.mocked(live.deals.listAll).mockResolvedValue([]);
    const fake = new FakeRevgasClient({ dealsSource: () => live.deals.listAll() });
    const client = new HybridRevgasClient(live, fake);
    await client.paymentTypes.list();
    expect(live.deals.listAll).toHaveBeenCalledTimes(1);
  });

  it('sales.get de venda simulada vai ao fake; de venda real vai ao live', async () => {
    const live = stubLive();
    const fake = new FakeRevgasClient();
    const client = new HybridRevgasClient(live, fake);
    const sale = await client.sales.create(saleInput);
    await client.sales.get(sale.id);
    expect(live.sales.get).not.toHaveBeenCalled();
    await client.sales.get(5);
    expect(live.sales.get).toHaveBeenCalledWith(5);
  });

  it('sales.list de cliente simulado vai ao fake; sem customer_id vai ao live', async () => {
    const live = stubLive();
    const fake = new FakeRevgasClient();
    const client = new HybridRevgasClient(live, fake);
    const customer = await client.customers.create({
      name: 'Cliente Teste',
      phones: ['5586988887777'],
    });
    expect(customer.id).toBeGreaterThanOrEqual(FAKE_ID_START);
    await client.sales.list({ customer_id: customer.id });
    expect(live.sales.list).not.toHaveBeenCalled();
    await client.sales.list({});
    await client.sales.list({ customer_id: 7 });
    expect(live.sales.list).toHaveBeenCalledTimes(2);
  });
});
