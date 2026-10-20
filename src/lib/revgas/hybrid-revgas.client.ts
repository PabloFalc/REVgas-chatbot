import type { FakeRevgasClient } from './fake/fake-revgas.client';
import type {
  ListDealsQuery,
  ListProductsQuery,
  ListSalesQuery,
  Page,
  RevgasClient,
} from './revgas.client';
import type {
  RevgasCustomer,
  RevgasCustomerInput,
  RevgasDeal,
  RevgasEstablishment,
  RevgasPaymentType,
  RevgasProduct,
  RevgasSale,
  RevgasSaleInput,
} from './revgas.schemas';

export class HybridRevgasClient implements RevgasClient {
  constructor(
    private readonly live: RevgasClient,
    private readonly fake: FakeRevgasClient,
  ) {}

  listEstablishments(): Promise<Page<RevgasEstablishment>> {
    return this.live.listEstablishments();
  }

  listProducts(query?: ListProductsQuery): Promise<Page<RevgasProduct>> {
    return this.live.listProducts(query);
  }

  listDeals(query?: ListDealsQuery): Promise<Page<RevgasDeal>> {
    return this.live.listDeals(query);
  }

  listAllDeals(query?: Omit<ListDealsQuery, 'page' | 'page_size'>): Promise<RevgasDeal[]> {
    return this.live.listAllDeals(query);
  }

  listPaymentTypes(): Promise<RevgasPaymentType[]> {
    return this.fake.listPaymentTypes();
  }

  findCustomersByPhone(phone: string): Promise<RevgasCustomer[]> {
    return this.fake.findCustomersByPhone(phone);
  }

  getCustomer(id: number): Promise<RevgasCustomer> {
    return this.fake.getCustomer(id);
  }

  createCustomer(input: RevgasCustomerInput): Promise<RevgasCustomer> {
    return this.fake.createCustomer(input);
  }

  updateCustomer(id: number, input: RevgasCustomerInput): Promise<RevgasCustomer> {
    return this.fake.updateCustomer(id, input);
  }

  createSale(input: RevgasSaleInput): Promise<RevgasSale> {
    return this.fake.createSale(input);
  }

  getSale(id: number): Promise<RevgasSale> {
    return this.fake.ownsSale(id) ? this.fake.getSale(id) : this.live.getSale(id);
  }

  listSales(query?: ListSalesQuery): Promise<Page<RevgasSale>> {
    const simulated = query?.customer_id !== undefined && this.fake.ownsCustomer(query.customer_id);
    return simulated ? this.fake.listSales(query) : this.live.listSales(query);
  }

  cancelSale(id: number, motiveCancelSaleId?: number | null): Promise<RevgasSale> {
    return this.fake.cancelSale(id, motiveCancelSaleId);
  }
}
