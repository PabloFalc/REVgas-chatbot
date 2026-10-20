import { describe, expect, it } from 'vitest';
import { RevgasDuplicateError, RevgasNotFoundError, RevgasValidationError } from '../revgas.errors';
import type { RevgasSaleInput } from '../revgas.schemas';
import { FakeRevgasClient } from './fake-revgas.client';
import { FAKE_CUSTOMERS, FAKE_ID_START, FAKE_PRODUCTS } from './fixtures';

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

const deal = (id: number, payment_type: string, payment_type_establishment_id?: number) => ({
  id,
  product_id: id,
  suggested_value: 1,
  minimum_value: 1,
  payment_type,
  payment_type_establishment_id,
});

describe('FakeRevgasClient', () => {
  it('acha cliente com telefone em formatos diferentes', async () => {
    const client = new FakeRevgasClient();
    const ids = await Promise.all(
      ['5586900000001', '+55 86 90000-0001', '86900000001'].map(async phone => {
        const found = await client.findCustomersByPhone(phone);
        return found.map(customer => customer.id);
      }),
    );
    expect(ids[0]).toEqual([FAKE_CUSTOMERS[0].id]);
    expect(ids[1]).toEqual(ids[0]);
    expect(ids[2]).toEqual(ids[0]);
  });

  it('telefone vazio ou curto não casa ninguém', async () => {
    const client = new FakeRevgasClient();
    for (const phone of ['', 'abc', '+', '88']) {
      expect(await client.findCustomersByPhone(phone)).toEqual([]);
    }
  });

  it('não casa DDDs diferentes com os mesmos dígitos do assinante', async () => {
    const client = new FakeRevgasClient();
    expect(await client.findCustomersByPhone('96900000001')).toEqual([]);
    expect(await client.findCustomersByPhone('5596900000001')).toEqual([]);
    const created = await client.createCustomer({ name: 'Outro DDD', phones: ['5596900000001'] });
    expect(created.id).not.toBe(FAKE_CUSTOMERS[0].id);
  });

  it('casa número de 10 dígitos com o de 11 dígitos de mesmo DDD e final', async () => {
    const client = new FakeRevgasClient();
    const found = await client.findCustomersByPhone('8600000001');
    expect(found.map(customer => customer.id)).toEqual([FAKE_CUSTOMERS[0].id]);
    expect(await client.findCustomersByPhone('9600000001')).toEqual([]);
  });

  it('cadastra cliente e acha pelo telefone', async () => {
    const client = new FakeRevgasClient();
    const created = await client.createCustomer({ name: 'Novo', phones: ['5586988887777'] });
    expect(created.id).toBeGreaterThanOrEqual(FAKE_ID_START);
    const found = await client.findCustomersByPhone('86988887777');
    expect(found.map(customer => customer.id)).toEqual([created.id]);
    expect((await client.getCustomer(created.id)).name).toBe('Novo');
  });

  it('recusa telefone duplicado com existingId', async () => {
    const client = new FakeRevgasClient();
    const error = await client
      .createCustomer({ name: 'Outro', phones: ['5586900000001'] })
      .catch(e => e);
    expect(error).toBeInstanceOf(RevgasDuplicateError);
    expect(error.existingId).toBe(FAKE_CUSTOMERS[0].id);
  });

  it('recusa phones com 11 dígitos', async () => {
    const client = new FakeRevgasClient();
    const error = await client.createCustomer({ name: 'X', phones: ['86988887777'] }).catch(e => e);
    expect(error).toBeInstanceOf(RevgasValidationError);
    expect(error.fields.map((f: { field: string }) => f.field)).toContain('phones');
  });

  it('atualiza e lê cliente, inexistente lança NotFound', async () => {
    const client = new FakeRevgasClient();
    const updated = await client.updateCustomer(FAKE_CUSTOMERS[0].id, { city: 'Timon' });
    expect(updated.city).toBe('Timon');
    await expect(client.getCustomer(1)).rejects.toBeInstanceOf(RevgasNotFoundError);
    await expect(client.updateCustomer(1, {})).rejects.toBeInstanceOf(RevgasNotFoundError);
  });

  it('não expõe estado interno por mutação', async () => {
    const client = new FakeRevgasClient();
    const customer = await client.getCustomer(FAKE_CUSTOMERS[0].id);
    customer.name = 'Alterado';
    expect((await client.getCustomer(FAKE_CUSTOMERS[0].id)).name).not.toBe('Alterado');
  });

  it('cria venda com total calculado e status OPEN', async () => {
    const time = clock();
    const client = new FakeRevgasClient({ now: time.now });
    const sale = await client.createSale(
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
    const client = new FakeRevgasClient();
    const error = await client.createSale(saleInput({ products: [] })).catch(e => e);
    expect(error).toBeInstanceOf(RevgasValidationError);
    expect(error.fields[0].field).toBe('products');
  });

  it('venda avança para ACTIVE aos 2 min e CONFIRM aos 10 min', async () => {
    const time = clock();
    const client = new FakeRevgasClient({ now: time.now });
    const { id } = await client.createSale(saleInput());
    time.advance(119_000);
    expect((await client.getSale(id)).status).toBe('OPEN');
    time.advance(1_000);
    const active = await client.getSale(id);
    expect(active.status).toBe('ACTIVE');
    expect(active.deliverer_id).toBe(FAKE_ID_START);
    expect(active.deliverer_name).toBe('Entregador Demo');
    time.advance(8 * 60_000);
    const confirmed = await client.getSale(id);
    expect(confirmed.status).toBe('CONFIRM');
    expect(confirmed.delivered_at).toBeTruthy();
  });

  it('venda cancelada não avança', async () => {
    const time = clock();
    const client = new FakeRevgasClient({ now: time.now });
    const { id } = await client.createSale(saleInput());
    expect((await client.cancelSale(id)).status).toBe('CANCEL');
    time.advance(60 * 60_000);
    expect((await client.getSale(id)).status).toBe('CANCEL');
  });

  it('getSale e cancelSale inexistentes lançam RevgasNotFoundError', async () => {
    const client = new FakeRevgasClient();
    await expect(client.getSale(FAKE_ID_START + 5)).rejects.toBeInstanceOf(RevgasNotFoundError);
    await expect(client.cancelSale(FAKE_ID_START + 5)).rejects.toBeInstanceOf(RevgasNotFoundError);
  });

  it('listSales por customer_id devolve só as vendas do cliente, mais recente primeiro', async () => {
    const time = clock();
    const client = new FakeRevgasClient({ now: time.now });
    const first = await client.createSale(saleInput({ customer_id: FAKE_CUSTOMERS[0].id }));
    time.advance(1000);
    await client.createSale(saleInput({ customer_id: FAKE_CUSTOMERS[1].id }));
    time.advance(1000);
    const third = await client.createSale(saleInput({ customer_id: FAKE_CUSTOMERS[0].id }));
    const result = await client.listSales({ customer_id: FAKE_CUSTOMERS[0].id });
    expect(result.data.map(sale => sale.id)).toEqual([third.id, first.id]);
    expect(result.pagination).toMatchObject({
      page: 1,
      count: 2,
      total_count: 2,
      has_next: false,
    });
  });

  it('listSales filtra por status e canal e pagina', async () => {
    const time = clock();
    const client = new FakeRevgasClient({ now: time.now });
    await client.createSale(saleInput());
    time.advance(1000);
    await client.createSale(saleInput());
    time.advance(1000);
    await client.createSale(saleInput());
    const page = await client.listSales({ page: 2, page_size: 2 });
    expect(page.data).toHaveLength(1);
    expect(page.pagination).toMatchObject({ page: 2, count: 1, total_count: 3, page_size: 2 });
    expect((await client.listSales({ status: 'CONFIRM' })).data).toHaveLength(0);
    expect((await client.listSales({ channel: 'DISK' })).data).toHaveLength(0);
  });

  it('listAllDeals filtra como listDeals', async () => {
    const client = new FakeRevgasClient();
    const all = await client.listAllDeals({ tag_id: 3519 });
    expect(all).toHaveLength(1);
    const page = await client.listDeals({ payment_type: 'PIX' });
    expect(page.data.every(item => item.payment_type === 'PIX')).toBe(true);
  });

  it('listPaymentTypes deriva dos acordos quando há dealsSource', async () => {
    const client = new FakeRevgasClient({
      dealsSource: async () => [
        deal(1, 'GAS_DO_POVO', 77),
        deal(2, 'GAS_DO_POVO', 77),
        deal(3, 'PIX'),
      ],
    });
    expect(await client.listPaymentTypes()).toEqual([
      { id: 77, payment_type: 'GAS_DO_POVO', status: 'ACTIVE' },
    ]);
    const plain = await new FakeRevgasClient().listPaymentTypes();
    expect(plain.map(type => type.payment_type)).toEqual([
      'MONEY',
      'PIX',
      'CARTAO_DE_CREDITO',
      'CARTAO_DE_DEBITO',
    ]);
  });

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
    const created = await client.createCustomer({ phones: ['5586911112222'] });
    expect(client.ownsCustomer(created.id)).toBe(true);
    const sale = await client.createSale(saleInput());
    expect(client.ownsSale(sale.id)).toBe(true);
    expect(client.ownsSale(sale.id + 1)).toBe(false);
    expect(client.ownsSale(10)).toBe(false);
  });
});
