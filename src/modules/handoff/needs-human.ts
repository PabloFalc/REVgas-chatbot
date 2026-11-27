import type { HandoffReason, HandoffTicketMeta } from './contracts/handoff.types';

export type HandoffCondition =
  | { type: 'customer_request' }
  | { type: 'emergency' }
  | { type: 'sale'; outcome: 'created' | 'failed' | 'rejected' | 'uncertain' }
  | { type: 'cancellation'; saleRegistered: boolean }
  | { type: 'quantity'; requested: number; max: number }
  | { type: 'identity'; outcome: 'confirmed' | 'failed' | 'unverifiable' };

const SALE_REASONS = {
  failed: 'sale_failed',
  rejected: 'sale_rejected',
  uncertain: 'sale_uncertain',
} as const;

export function handoffReasonFor(condition: HandoffCondition): HandoffReason | null {
  switch (condition.type) {
    case 'customer_request':
      return 'customer_request';
    case 'emergency':
      return 'emergency';
    case 'sale':
      return condition.outcome === 'created' ? null : SALE_REASONS[condition.outcome];
    case 'cancellation':
      return condition.saleRegistered ? 'sale_cancellation' : null;
    case 'quantity':
      return condition.requested > condition.max ? 'quantity_limit' : null;
    case 'identity':
      return condition.outcome === 'confirmed' ? null : 'identity_failure';
  }
}

export function needsHuman(condition: HandoffCondition): boolean {
  return handoffReasonFor(condition) !== null;
}

const SALE_FAILURE: HandoffTicketMeta = { label: 'sale-failure', priority: 'high' };
const NEEDS_REVIEW: HandoffTicketMeta = { label: 'needs-review', priority: 'normal' };

const TICKET_META: Record<HandoffReason, HandoffTicketMeta> = {
  emergency: { label: 'emergency', priority: 'urgent' },
  sale_failed: SALE_FAILURE,
  sale_rejected: SALE_FAILURE,
  sale_uncertain: SALE_FAILURE,
  sale_cancellation: { label: 'sale-cancellation', priority: 'high' },
  quantity_limit: NEEDS_REVIEW,
  identity_failure: NEEDS_REVIEW,
  customer_request: { label: 'customer-request', priority: 'normal' },
};

export function ticketMetaFor(reason: HandoffReason): HandoffTicketMeta {
  return TICKET_META[reason];
}
