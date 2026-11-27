import type { RevgasErrorKind } from 'src/core/erros/revgas/revgas.errors';
import type { Step } from 'src/modules/conversation/flow/flow.types';
import type { HandoffReason, HandoffStatus } from 'src/modules/handoff/contracts/handoff.types';

export type CommercialField = 'product' | 'quantity' | 'payment' | 'address';

type Cycle = { cycleId?: string };
export type MetricEvent = Cycle &
  (
    | { name: 'turn'; prevStep?: Step; step?: Step; durationMs: number }
    | { name: 'reminder_sent'; step: Step }
    | {
        name: 'sale';
        outcome: 'created' | 'failed' | 'rejected';
        reason: 'direct' | 'recovered' | RevgasErrorKind | 'unexpected';
      }
    | { name: 'order_cancelled' }
    | { name: 'purchase_started'; reason: 'new' | 'recurring' | 'unknown' }
    | { name: 'handoff'; outcome: HandoffStatus; reason: HandoffReason }
    | { name: 'handoff_offered'; reason: 'stuck' | 'offense' }
    | { name: 'quantity_limit'; reason: 'max' | 'stock' }
    | { name: 'emergency'; reason: 'agent_route' }
    | {
        name: 'rag';
        outcome: 'answered' | 'unknown';
        reason?: 'no_match' | 'not_in_sources' | 'rejected' | 'unavailable';
        durationMs: number;
      }
    | {
        name: 'ai_call';
        outcome: 'allowed' | 'limited';
        reason: 'interpret' | 'read_name' | 'address' | 'question';
        amount: number;
      }
    | { name: 'order_status'; outcome: 'found' | 'none' }
    | { name: 'cpf'; outcome: 'mismatch' | 'blocked' | 'blocked_hit'; amount: number }
    | { name: 'summary_confirmation_rejected'; reason: 'stale_revision' }
    | { name: 'summary_changed'; fields: CommercialField[] }
  );
