import { describe, expect, it } from 'vitest';
import {
  RevgasDealSchema,
  RevgasPaginationSchema,
  RevgasProductSchema,
  RevgasSaleInputSchema,
  RevgasSaleSchema,
} from './revgas.schemas';

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

describe('revgas schemas', () => {
  it('preserva campos desconhecidos', () => {
    const parsed = RevgasProductSchema.parse({ id: 1, description: 'P13', commission_value: 0 });
    expect(parsed).toHaveProperty('commission_value', 0);
  });

  it('aceita payment_type fora da spec', () => {
    const base = { id: 1, product_id: 2, suggested_value: 10, minimum_value: 5 };
    expect(RevgasDealSchema.safeParse({ ...base, payment_type: 'GAS_DO_POVO' }).success).toBe(true);
    expect(RevgasDealSchema.safeParse({ ...base, payment_type: 'NOVO_TIPO' }).success).toBe(true);
  });

  it('aceita status de venda desconhecido', () => {
    expect(RevgasSaleSchema.safeParse({ id: 1, status: 'RECEIVED' }).success).toBe(true);
    expect(RevgasSaleSchema.safeParse({ id: 1, status: 'WARNING' }).success).toBe(true);
  });

  it('exige id', () => {
    expect(RevgasProductSchema.safeParse({ description: 'P13' }).success).toBe(false);
  });

  it('aceita customer_id null na venda', () => {
    expect(RevgasSaleSchema.safeParse({ id: 1, status: 'OPEN', customer_id: null }).success).toBe(
      true,
    );
  });

  it('pagination sem has_next passa', () => {
    expect(RevgasPaginationSchema.safeParse({ page: 1, count: 1, total_count: 1 }).success).toBe(
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
