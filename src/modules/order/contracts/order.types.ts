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
