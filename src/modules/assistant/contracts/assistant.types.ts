export interface InterpretContext {
  products: string[];
  payments: { type: string; label: string }[];
}

export type InterpretationTopic = 'hours' | 'payments' | 'general' | 'invite' | 'delivery_fee';

export interface Interpretation {
  intent: 'order' | 'question' | 'price' | 'handoff' | 'off_topic' | 'offense' | 'other';
  topic?: InterpretationTopic;
  unknownProduct?: string;
  products?: string[];
  quantity?: number;
  payment?: string;
  address?: string;
  newAddress?: boolean;
  confidence: number;
}

export interface NameReading {
  name: string | null;
  isPersonName: boolean;
}
