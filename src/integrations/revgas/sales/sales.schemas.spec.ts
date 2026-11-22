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
  products: [{ product_id: 1, quantity: 1, value: 100 }],
  payments: [{ payment_type: 'PIX', value: 100 }],
};

describe('sales schemas', () => {
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
