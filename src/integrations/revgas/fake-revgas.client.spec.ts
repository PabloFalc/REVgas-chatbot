import { describe, expect, it } from 'vitest';
import { FAKE_CUSTOMERS } from './customers/customers.fixtures';
import { FakeRevgasClient } from './fake-revgas.client';
import { FAKE_PRODUCTS } from './products/products.fixtures';
import { FAKE_ID_START } from './shared/fake-id';

describe('FakeRevgasClient', () => {
  it('ownsSale/ownsCustomer verdadeiros só para ids >= FAKE_ID_START criados ou semeados', async () => {
    const client = new FakeRevgasClient({
      seedCustomers: [
        { id: 5, name: 'Baixo' },
        { id: FAKE_ID_START + 900, name: 'Alto' },
      ],
    });
    expect(client.ownsCustomer(FAKE_CUSTOMERS[0].id)).toBe(true);
    expect(client.ownsCustomer(FAKE_ID_START + 900)).toBe(true);
    expect(client.ownsCustomer(5)).toBe(false);
    expect(client.ownsCustomer(FAKE_ID_START + 12345)).toBe(false);
    const created = await client.customers.create({ phones: ['5586911112222'] });
    expect(client.ownsCustomer(created.id)).toBe(true);
    const sale = await client.sales.create({
      location: 'Rua Exemplo',
      number: '10',
      neighborhood: 'Centro',
      city: 'Teresina',
      state_federation: 'PI',
      products: [{ product_id: FAKE_PRODUCTS[0].id, quantity: 1, value: 100 }],
      payments: [{ payment_type: 'PIX', value: 100 }],
    });
    expect(client.ownsSale(sale.id)).toBe(true);
    expect(client.ownsSale(sale.id + 1)).toBe(false);
    expect(client.ownsSale(10)).toBe(false);
  });

  it('venda usa o nome do cliente semeado', async () => {
    const client = new FakeRevgasClient();
    const sale = await client.sales.create({
      location: 'Rua Exemplo',
      number: '10',
      neighborhood: 'Centro',
      city: 'Teresina',
      state_federation: 'PI',
      customer_id: FAKE_CUSTOMERS[0].id,
      products: [{ product_id: FAKE_PRODUCTS[0].id, quantity: 1, value: 100 }],
      payments: [{ payment_type: 'PIX', value: 100 }],
    });
    expect(sale.customer_name).toBe(FAKE_CUSTOMERS[0].name);
  });
});
