import { CustomersFake } from './customers/customers.fake';
import type { RevgasCustomer } from './customers/customers.schemas';
import { DealsFake } from './deals/deals.fake';
import type { RevgasDeal } from './deals/deals.schemas';
import { EstablishmentsFake } from './establishments/establishments.fake';
import { PaymentTypesFake } from './payment-types/payment-types.fake';
import { ProductsFake } from './products/products.fake';
import type { RevgasClient } from './revgas.client';
import { SalesFake } from './sales/sales.fake';

export { FAKE_ID_START } from './shared/fake';

export type FakeRevgasOptions = {
  now?: () => number;
  seedCustomers?: RevgasCustomer[];
  dealsSource?: () => Promise<RevgasDeal[]>;
};

export class FakeRevgasClient implements RevgasClient {
  readonly establishments: EstablishmentsFake;
  readonly products: ProductsFake;
  readonly deals: DealsFake;
  readonly paymentTypes: PaymentTypesFake;
  readonly customers: CustomersFake;
  readonly sales: SalesFake;

  constructor(options: FakeRevgasOptions = {}) {
    this.establishments = new EstablishmentsFake();
    this.products = new ProductsFake();
    this.deals = new DealsFake();
    this.paymentTypes = new PaymentTypesFake(options.dealsSource);
    this.customers = new CustomersFake(options.seedCustomers);
    this.sales = new SalesFake(this.customers, options.now);
  }

  ownsSale(id: number): boolean {
    return this.sales.owns(id);
  }

  ownsCustomer(id: number): boolean {
    return this.customers.owns(id);
  }
}
