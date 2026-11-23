import type { Address } from 'src/modules/address/contracts/address.types';

export interface SaleOrder {
  customerId: number;
  address: Address;
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  paymentType: string;
  total: number;
  observation?: string;
}

export class SaleRejectedError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface OrderStatus {
  saleId: number;
  status: string;
  delivererName?: string | null;
  deliveredAt?: string | null;
}
