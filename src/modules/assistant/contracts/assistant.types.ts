export interface InterpretContext {
  products: string[];
  payments: { type: string; label: string }[];
}

export interface Interpretation {
  intent: 'order' | 'question' | 'price' | 'handoff' | 'off_topic' | 'offense' | 'other';
  topic?: 'hours' | 'payments' | 'general';
  unknownProduct?: string;
  products?: string[];
  quantity?: number;
  payment?: string;
  address?: string;
  newAddress?: boolean;
  confidence: number;
}
