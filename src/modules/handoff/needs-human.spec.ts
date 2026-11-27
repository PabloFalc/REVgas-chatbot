import { describe, expect, it } from 'vitest';
import { type HandoffCondition, handoffReasonFor, needsHuman, ticketMetaFor } from './needs-human';

describe('needsHuman', () => {
  it('needsHuman retorna true somente para condições que exigem atendimento', () => {
    const exigem: [HandoffCondition, string][] = [
      [{ type: 'customer_request' }, 'customer_request'],
      [{ type: 'emergency' }, 'emergency'],
      [{ type: 'sale', outcome: 'failed' }, 'sale_failed'],
      [{ type: 'sale', outcome: 'rejected' }, 'sale_rejected'],
      [{ type: 'sale', outcome: 'uncertain' }, 'sale_uncertain'],
      [{ type: 'cancellation', saleRegistered: true }, 'sale_cancellation'],
      [{ type: 'quantity', requested: 21, max: 20 }, 'quantity_limit'],
      [{ type: 'identity', outcome: 'failed' }, 'identity_failure'],
      [{ type: 'identity', outcome: 'unverifiable' }, 'identity_failure'],
    ];
    for (const [condition, reason] of exigem) {
      expect(needsHuman(condition), reason).toBe(true);
      expect(handoffReasonFor(condition)).toBe(reason);
    }

    const normais: HandoffCondition[] = [
      { type: 'sale', outcome: 'created' },
      { type: 'cancellation', saleRegistered: false },
      { type: 'quantity', requested: 20, max: 20 },
      { type: 'quantity', requested: 1, max: 20 },
      { type: 'identity', outcome: 'confirmed' },
    ];
    for (const condition of normais) {
      expect(needsHuman(condition), JSON.stringify(condition)).toBe(false);
      expect(handoffReasonFor(condition)).toBeNull();
    }
  });

  it('associa etiqueta e prioridade a cada motivo', () => {
    expect(ticketMetaFor('emergency')).toEqual({ label: 'emergency', priority: 'urgent' });
    expect(ticketMetaFor('sale_failed')).toEqual({ label: 'sale-failure', priority: 'high' });
    expect(ticketMetaFor('sale_rejected')).toEqual({ label: 'sale-failure', priority: 'high' });
    expect(ticketMetaFor('sale_uncertain')).toEqual({ label: 'sale-failure', priority: 'high' });
    expect(ticketMetaFor('sale_cancellation')).toEqual({
      label: 'sale-cancellation',
      priority: 'high',
    });
    expect(ticketMetaFor('quantity_limit')).toEqual({ label: 'needs-review', priority: 'normal' });
    expect(ticketMetaFor('identity_failure')).toEqual({
      label: 'needs-review',
      priority: 'normal',
    });
    expect(ticketMetaFor('customer_request')).toEqual({
      label: 'customer-request',
      priority: 'normal',
    });
  });
});
