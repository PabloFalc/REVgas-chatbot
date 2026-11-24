import { describe, expect, it } from 'vitest';
import { RevgasDealSchema } from './deals.schemas';

describe('deals schemas', () => {
  it('aceita payment_type fora da spec', () => {
    const base = { id: 1, product_id: 2, suggested_value: 10, minimum_value: 5 };
    expect(RevgasDealSchema.safeParse({ ...base, payment_type: 'GAS_DO_POVO' }).success).toBe(true);
    expect(RevgasDealSchema.safeParse({ ...base, payment_type: 'NOVO_TIPO' }).success).toBe(true);
  });
  it.each([10, '0.01'])('normaliza valores de acordo %s', value => {
    const deal = RevgasDealSchema.parse({
      id: 1,
      product_id: 2,
      suggested_value: value,
      minimum_value: value,
      payment_type: 'PIX',
    });
    expect(deal.suggested_value).toBe(Number(value));
    expect(deal.minimum_value).toBe(Number(value));
  });

  it.each(['', ' ', 'abc', '10abc', 'Infinity', '0x10'])('recusa valor inválido %s', value => {
    const base = {
      id: 1,
      product_id: 2,
      suggested_value: 10,
      minimum_value: 5,
      payment_type: 'PIX',
    };
    expect(RevgasDealSchema.safeParse({ ...base, suggested_value: value }).success).toBe(false);
    expect(RevgasDealSchema.safeParse({ ...base, minimum_value: value }).success).toBe(false);
  });
});
