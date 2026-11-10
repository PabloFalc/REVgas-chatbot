import type { Opening, ServiceWindow } from 'src/utils/service-hours';

export type HandoffReason = 'customer_request' | 'sale_failed';

export interface HandoffOrderSummary {
  stepLabel: string;
  identityConfirmed: boolean;
  newCustomer: boolean;
  customerName?: string;
  product?: string;
  quantity?: number;
  address?: string;
  payment?: string;
  total?: number;
}

export interface HandoffRequest {
  phone: string;
  reason: HandoffReason;
  summary: HandoffOrderSummary | null;
}

export type HandoffStatus = 'queued' | 'alreadyQueued' | 'active' | 'unavailable';

export interface HandoffOutcome {
  status: HandoffStatus;
  open: boolean;
  nextOpening: Opening | null;
}

export interface ServiceHoursInfo {
  open: boolean;
  nextOpening: Opening | null;
  windows: ServiceWindow[];
}

export type DeskInbound =
  | { type: 'text'; text: string }
  | { type: 'choice'; title: string }
  | { type: 'unsupported'; originalType?: string };

export type DeskEvent =
  | {
      kind: 'agentMessage';
      messageId: number;
      conversationId: number;
      inboxId: number;
      phone: string | null;
      agentName: string;
      content: string;
    }
  | {
      kind: 'conversationResolved';
      conversationId: number;
      inboxId: number;
      phone: string | null;
    };

export interface HandoffState {
  status: 'queued' | 'active';
  conversationId: number;
  reason: HandoffReason | 'agent';
  since: string;
  lastAgentAt?: string;
}

export interface DeskThread {
  conversationId: number;
}

export interface DeskContact {
  contactId: number;
  sourceId: string;
}
