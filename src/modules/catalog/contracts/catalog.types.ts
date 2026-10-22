export interface Product {
  id: number;
  name: string;
}

export interface PaymentOption {
  type: string;
  label: string;
}

export interface Quote {
  unitPrice: number;
  total: number;
}

export interface PriceCustomer {
  id?: number;
  tagId?: number | null;
}
