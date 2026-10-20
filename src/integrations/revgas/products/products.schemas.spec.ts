import { describe, expect, it } from 'vitest';
import { RevgasProductSchema } from './products.schemas';

describe('products schemas', () => {
  it('preserva campos desconhecidos', () => {
    const parsed = RevgasProductSchema.parse({ id: 1, description: 'P13', commission_value: 0 });
    expect(parsed).toHaveProperty('commission_value', 0);
  });

  it('exige id', () => {
    expect(RevgasProductSchema.safeParse({ description: 'P13' }).success).toBe(false);
  });
});
