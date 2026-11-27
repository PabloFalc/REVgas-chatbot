import { describe, expect, it } from 'vitest';
import { customerSegmentOf } from './customer-segment';
import type { OrderState } from './flow.types';

function stateWith(extra: Partial<OrderState>): OrderState {
  return { step: 'summary', customer: { id: 1 }, ...extra };
}

describe('customerSegmentOf', () => {
  it('sem histórico carregado é new, com histórico vazio é unknown e com itens é recurring', () => {
    expect(customerSegmentOf(stateWith({}))).toBe('new');
    expect(customerSegmentOf(stateWith({ boughtProductIds: [] }))).toBe('unknown');
    expect(customerSegmentOf(stateWith({ boughtProductIds: [3, 7] }))).toBe('recurring');
  });
});
