import type { CustomersApi } from './customers/customers.api';
import type { DealsApi } from './deals/deals.api';
import type { EstablishmentsApi } from './establishments/establishments.api';
import type { PaymentTypesApi } from './payment-types/payment-types.api';
import type { ProductsApi } from './products/products.api';
import type { SalesApi } from './sales/sales.api';

export const REVGAS_CLIENT = Symbol('REVGAS_CLIENT');

export interface RevgasClient {
  readonly establishments: EstablishmentsApi;
  readonly products: ProductsApi;
  readonly deals: DealsApi;
  readonly paymentTypes: PaymentTypesApi;
  readonly customers: CustomersApi;
  readonly sales: SalesApi;
}
