import { describe, expect, it } from 'vitest';
import { CustomersFake } from '../customers/customers.fake';
import { FAKE_CUSTOMERS } from '../customers/customers.fixtures';
import { FAKE_PRODUCTS } from '../products/products.fixtures';
import { FAKE_ID_START } from '../shared/fake';
import { RevgasNotFoundError, RevgasValidationError } from '../shared/revgas.errors';
import { SalesFake } from './sales.fake';
import type { RevgasSaleInput } from './sales.schemas';

const saleInput = (overrides: Partial<RevgasSaleInput> = {}): RevgasSaleInput => ({
  location: 'Rua Exemplo',
  number: '10',
  neighborhood: 'Centro',
  city: 'Teresina',
  state_federation: 'PI',
  products: [{ product_id: FAKE_PRODUCTS[0].id, quantity: 2, value: 125 }],
  payments: [{ payment_type: 'PIX', value: 250 }],
  ...overrides,
});

const clock = (start = 1_000_000) => {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
};

const setup = (now?: () => number) => new SalesFake(new CustomersFake(), now);

describe('SalesFake', () => {
  it('cria venda com total calculado e status OPEN', async () => {
    const time = clock();
    const fake = setup(time.now);
    const sale = await fake.create(
      saleInput({
        customer_id: FAKE_CUSTOMERS[0].id,
        products: [
          { product_id: FAKE_PRODUCTS[0].id, quantity: 2, value: 125 },
          { product_id: FAKE_PRODUCTS[2].id, quantity: 1, value: 12 },
        ],
        payments: [{ payment_type: 'PIX', value: 262 }],
      }),
    );
    expect(sale.id).toBeGreaterThanOrEqual(FAKE_ID_START);
    expect(sale.total).toBe(262);
    expect(sale.status).toBe('OPEN');
    expect(sale.channel).toBe('WHATSAPP');
    expect(sale.customer_name).toBe(FAKE_CUSTOMERS[0].name);
    expect(sale.date).toBe(new Date(time.now()).toISOString());
  });

  it('rejeita venda inválida com RevgasValidationError', async () => {
    const error = await setup()
      .create(saleInput({ products: [] }))
      .catch(e => e);
    expect(error).toBeInstanceOf(RevgasValidationError);
    expect(error.fields[0].field).toBe('products');
  });

  it('venda avança para ACTIVE aos 2 min e CONFIRM aos 10 min', async () => {
    const time = clock();
    const fake = setup(time.now);
    const { id } = await fake.create(saleInput());
    time.advance(119_000);
    expect((await fake.get(id)).status).toBe('OPEN');
    time.advance(1_000);
    const active = await fake.get(id);
    expect(active.status).toBe('ACTIVE');
    expect(active.deliverer_id).toBe(FAKE_ID_START);
    expect(active.deliverer_name).toBe('Entregador Demo');
    time.advance(8 * 60_000);
    const confirmed = await fake.get(id);
    expect(confirmed.status).toBe('CONFIRM');
    expect(confirmed.delivered_at).toBeTruthy();
  });

  it('venda cancelada não avança', async () => {
    const time = clock();
    const fake = setup(time.now);
    const { id } = await fake.create(saleInput());
    expect((await fake.cancel(id)).status).toBe('CANCEL');
    time.advance(60 * 60_000);
    expect((await fake.get(id)).status).toBe('CANCEL');
  });

  it('get e cancel inexistentes lançam RevgasNotFoundError', async () => {
    const fake = setup();
    await expect(fake.get(FAKE_ID_START + 5)).rejects.toBeInstanceOf(RevgasNotFoundError);
    await expect(fake.cancel(FAKE_ID_START + 5)).rejects.toBeInstanceOf(RevgasNotFoundError);
  });

  it('list por customer_id devolve só as vendas do cliente, mais recente primeiro', async () => {
    const time = clock();
    const fake = setup(time.now);
    const first = await fake.create(saleInput({ customer_id: FAKE_CUSTOMERS[0].id }));
    time.advance(1000);
    await fake.create(saleInput({ customer_id: FAKE_CUSTOMERS[1].id }));
    time.advance(1000);
    const third = await fake.create(saleInput({ customer_id: FAKE_CUSTOMERS[0].id }));
    const result = await fake.list({ customer_id: FAKE_CUSTOMERS[0].id });
    expect(result.data.map(sale => sale.id)).toEqual([third.id, first.id]);
    expect(result.pagination).toMatchObject({
      page: 1,
      count: 2,
      total_count: 2,
      has_next: false,
    });
  });

  it('list filtra por status e canal e pagina', async () => {
    const time = clock();
    const fake = setup(time.now);
    await fake.create(saleInput());
    time.advance(1000);
    await fake.create(saleInput());
    time.advance(1000);
    await fake.create(saleInput());
    const page = await fake.list({ page: 2, page_size: 2 });
    expect(page.data).toHaveLength(1);
    expect(page.pagination).toMatchObject({ page: 2, count: 1, total_count: 3, page_size: 2 });
    expect((await fake.list({ status: 'CONFIRM' })).data).toHaveLength(0);
    expect((await fake.list({ channel: 'DISK' })).data).toHaveLength(0);
  });

  it('owns é verdadeiro só para vendas criadas com id >= FAKE_ID_START', async () => {
    const fake = setup();
    const sale = await fake.create(saleInput());
    expect(fake.owns(sale.id)).toBe(true);
    expect(fake.owns(sale.id + 1)).toBe(false);
    expect(fake.owns(10)).toBe(false);
  });
});
