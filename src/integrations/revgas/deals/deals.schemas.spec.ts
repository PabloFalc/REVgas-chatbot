import { describe, expect, it } from 'vitest';
import { RevgasDealSchema } from './deals.schemas';

describe('deals schemas', () => {
  it('aceita payment_type fora da spec', () => {
    const base = { id: 1, product_id: 2, suggested_value: 10, minimum_value: 5 };
    expect(RevgasDealSchema.safeParse({ ...base, payment_type: 'GAS_DO_POVO' }).success).toBe(true);
    expect(RevgasDealSchema.safeParse({ ...base, payment_type: 'NOVO_TIPO' }).success).toBe(true);
  });
});
