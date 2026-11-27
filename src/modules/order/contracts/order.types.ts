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

export type CustomerSegment = 'new' | 'recurring' | 'unknown';

export type SaleAttemptStatus = 'pending' | 'registered' | 'rejected' | 'uncertain' | 'failed';

export type SaleAttemptErrorKind =
  | 'validation'
  | 'timeout'
  | 'server_error'
  | 'network'
  | 'invalid_response'
  | 'stale'
  | 'restart'
  | 'unauthorized'
  | 'blocked'
  | 'forbidden'
  | 'not_found'
  | 'unavailable'
  | 'duplicate'
  | 'unexpected';

export interface SaleAttemptInput {
  cycleId: string;
  customerId: number;
  totalCents: number;
  productCode: string;
  paymentMethodCode: string;
  customerSegment: CustomerSegment;
  isSimulated: boolean;
}

export interface SaleAttemptOutcome {
  status: Exclude<SaleAttemptStatus, 'pending'>;
  errorKind?: SaleAttemptErrorKind;
  erpSaleId?: number;
}

export class SaleAttemptStoreError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class SaleUncertainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SaleAlreadyRegisteredError extends Error {
  constructor(readonly saleId: number) {
    super(`Venda ${saleId} já registrada neste ciclo`);
    this.name = new.target.name;
  }
}

export interface OrderStatus {
  saleId: number;
  status: string;
  delivererName?: string | null;
  deliveredAt?: string | null;
}
