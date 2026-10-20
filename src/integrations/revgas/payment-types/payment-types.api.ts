import type { RevgasPaymentType } from './payment-types.schemas';

export interface PaymentTypesApi {
  list(): Promise<RevgasPaymentType[]>;
}
