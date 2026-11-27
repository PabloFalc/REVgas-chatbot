import { describe, expect, it } from 'vitest';
import { RevgasSaleInputSchema, RevgasSaleSchema } from './sales.schemas';

const address = {
  location: 'Rua A',
  number: '10',
  neighborhood: 'Centro',
  city: 'Teresina',
  state_federation: 'PI',
};

const saleInput = {
  ...address,
  option: 'NORMAL',
  products: [{ product_id: 1, quantity: 1, value: 100 }],
  payments: [{ payment_type: 'PIX', value: 100 }],
};

describe('sales schemas', () => {
  it.each(['payment_type', 'type'])('normaliza pagamento com %s', field => {
    const sale = RevgasSaleSchema.parse({
      id: 1,
      status: 'OPEN',
      payments: [{ [field]: 'NOVO_TIPO', value: 100 }],
    });
    expect(sale.payments?.[0]?.payment_type).toBe('NOVO_TIPO');
  });

  it.each([-5.1, '-5.1'])('aceita coordenadas %s', coordinate => {
    const coordinates = { lat: coordinate, lon: coordinate };
    expect(RevgasSaleSchema.parse({ id: 1, status: 'OPEN', ...coordinates })).toMatchObject(
      coordinates,
    );
    expect(RevgasSaleInputSchema.parse({ ...saleInput, ...coordinates })).toMatchObject(
      coordinates,
    );
  });

  it('mantém payment_type na criação', () => {
    expect(RevgasSaleInputSchema.parse(saleInput).payments).toEqual(saleInput.payments);
  });

  it('aceita status de venda desconhecido', () => {
    expect(RevgasSaleSchema.safeParse({ id: 1, status: 'RECEIVED' }).success).toBe(true);
    expect(RevgasSaleSchema.safeParse({ id: 1, status: 'WARNING' }).success).toBe(true);
  });

  it('aceita customer_id null na venda', () => {
    expect(RevgasSaleSchema.safeParse({ id: 1, status: 'OPEN', customer_id: null }).success).toBe(
      true,
    );
  });

  it('RevgasSaleInputSchema recusa produtos vazios, quantidade 0 e valor 0', () => {
    expect(RevgasSaleInputSchema.safeParse({ ...saleInput, products: [] }).success).toBe(false);
    expect(
      RevgasSaleInputSchema.safeParse({
        ...saleInput,
        products: [{ product_id: 1, quantity: 0, value: 100 }],
      }).success,
    ).toBe(false);
    expect(
      RevgasSaleInputSchema.safeParse({
        ...saleInput,
        products: [{ product_id: 1, quantity: 1, value: 0 }],
      }).success,
    ).toBe(false);
  });

  it('aplica channel WHATSAPP por padrão', () => {
    expect(RevgasSaleInputSchema.parse(saleInput).channel).toBe('WHATSAPP');
  });
});
