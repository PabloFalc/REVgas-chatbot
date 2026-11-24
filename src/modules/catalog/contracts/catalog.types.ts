export interface Product {
  id: number;
  name: string;
  stock?: number;
}

export interface PaymentOption {
  type: string;
  label: string;
}

export interface Quote {
  unitPrice: number;
  total: number;
}

export interface BasePrice {
  product: Product;
  minPrice: number;
  varies: boolean;
}

export interface PriceCustomer {
  id?: number;
  tagId?: number | null;
}
