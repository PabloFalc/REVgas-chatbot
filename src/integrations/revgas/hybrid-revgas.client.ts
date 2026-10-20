import type { CustomersApi } from './customers/customers.api';
import type { DealsApi } from './deals/deals.api';
import type { EstablishmentsApi } from './establishments/establishments.api';
import type { FakeRevgasClient } from './fake-revgas.client';
import type { PaymentTypesApi } from './payment-types/payment-types.api';
import type { ProductsApi } from './products/products.api';
import type { RevgasClient } from './revgas.client';
import type { ListSalesQuery, SalesApi } from './sales/sales.api';
import type { RevgasSale, RevgasSaleInput } from './sales/sales.schemas';
import type { Page } from './shared/pagination';

export class HybridRevgasClient implements RevgasClient {
  readonly establishments: EstablishmentsApi;
  readonly products: ProductsApi;
  readonly deals: DealsApi;
  readonly paymentTypes: PaymentTypesApi;
  readonly customers: CustomersApi;
  readonly sales: SalesApi;

  constructor(live: RevgasClient, fake: FakeRevgasClient) {
    this.establishments = live.establishments;
    this.products = live.products;
    this.deals = live.deals;
    this.paymentTypes = fake.paymentTypes;
    this.customers = fake.customers;
    this.sales = {
      create: (input: RevgasSaleInput): Promise<RevgasSale> => fake.sales.create(input),
      get: (id: number): Promise<RevgasSale> =>
        fake.ownsSale(id) ? fake.sales.get(id) : live.sales.get(id),
      list: (query?: ListSalesQuery): Promise<Page<RevgasSale>> => {
        const simulated = query?.customer_id !== undefined && fake.ownsCustomer(query.customer_id);
        return simulated ? fake.sales.list(query) : live.sales.list(query);
      },
      cancel: (id: number, motiveCancelSaleId?: number | null): Promise<RevgasSale> =>
        fake.sales.cancel(id, motiveCancelSaleId),
    };
  }
}
