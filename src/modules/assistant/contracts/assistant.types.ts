export interface InterpretContext {
  products: string[];
  payments: { type: string; label: string }[];
}

export interface Interpretation {
  intent: 'order' | 'question' | 'other';
  products?: string[];
  quantity?: number;
  payment?: string;
  address?: string;
  newAddress?: boolean;
  confidence: number;
}
