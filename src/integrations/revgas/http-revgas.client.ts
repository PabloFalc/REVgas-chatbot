import { CustomersHttp } from './customers/customers.http';
import { DealsHttp } from './deals/deals.http';
import { EstablishmentsHttp } from './establishments/establishments.http';
import { PaymentTypesHttp } from './payment-types/payment-types.http';
import { ProductsHttp } from './products/products.http';
import type { RevgasClient } from './revgas.client';
import { SalesHttp } from './sales/sales.http';
import type { RevgasHttp } from './shared/revgas-http';

export function createHttpRevgasClient(http: RevgasHttp, establishmentId: number): RevgasClient {
  return {
    establishments: new EstablishmentsHttp(http),
    products: new ProductsHttp(http, establishmentId),
    deals: new DealsHttp(http, establishmentId),
    paymentTypes: new PaymentTypesHttp(http, establishmentId),
    customers: new CustomersHttp(http),
    sales: new SalesHttp(http, establishmentId),
  };
}
