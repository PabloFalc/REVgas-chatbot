import type { OrderState } from './flow.types';

export type CustomerSegment = 'new' | 'recurring' | 'unknown';

export function customerSegmentOf(state: OrderState): CustomerSegment {
  if (state.boughtProductIds === undefined) return 'new';
  return state.boughtProductIds.length === 0 ? 'unknown' : 'recurring';
}
