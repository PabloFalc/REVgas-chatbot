import type { RevgasDeal } from 'src/integrations/revgas/deals/deals.schemas';
import { describe, expect, it } from 'vitest';
import { pickDeal } from './price';

const deal = (over: Partial<RevgasDeal>): RevgasDeal =>
  ({
    id: 1,
    product_id: 10,
    suggested_value: 100,
    minimum_value: 90,
    payment_type: 'PIX',
    ...over,
  }) as RevgasDeal;

describe('pickDeal', () => {
  const base = deal({ id: 1, type: 'PAYMENT_TYPE' });
  const tag = deal({ id: 2, type: 'TAG', tag_id: 5 });
  const customer = deal({ id: 3, type: 'CUSTOMER', customer_id: 7 });

  it('prefers the customer deal over tag and base', () => {
    expect(pickDeal([base, tag, customer], 10, 'PIX', { id: 7, tagId: 5 })?.id).toBe(3);
  });

  it('prefers the tag deal over base when no customer deal', () => {
    expect(pickDeal([base, tag], 10, 'PIX', { id: 7, tagId: 5 })?.id).toBe(2);
  });

  it('falls back to base, treating a missing type as base', () => {
    const untyped = deal({ id: 4 });
    expect(pickDeal([untyped], 10, 'PIX', {})?.id).toBe(4);
  });

  it('prefers is_default among bases', () => {
    const def = deal({ id: 5, type: 'PAYMENT_TYPE', is_default: true });
    expect(pickDeal([base, def], 10, 'PIX', {})?.id).toBe(5);
  });

  it('never uses deals of another customer or tag', () => {
    expect(pickDeal([tag, customer], 10, 'PIX', { id: 8, tagId: 6 })).toBeNull();
  });

  it('ignores other products and payment types', () => {
    expect(pickDeal([base], 11, 'PIX', {})).toBeNull();
    expect(pickDeal([base], 10, 'MONEY', {})).toBeNull();
  });

  it('returns null when nothing applies', () => {
    expect(pickDeal([], 10, 'PIX', {})).toBeNull();
  });
});
