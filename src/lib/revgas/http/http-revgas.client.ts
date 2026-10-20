import type {
  ListDealsQuery,
  ListProductsQuery,
  ListSalesQuery,
  Page,
  RevgasClient,
} from '../revgas.client';
import { RevgasValidationError } from '../revgas.errors';
import {
  pageSchema,
  type RevgasCustomer,
  type RevgasCustomerInput,
  RevgasCustomerSchema,
  type RevgasDeal,
  RevgasDealSchema,
  type RevgasEstablishment,
  RevgasEstablishmentSchema,
  type RevgasPaymentType,
  RevgasPaymentTypeSchema,
  type RevgasProduct,
  RevgasProductSchema,
  type RevgasSale,
  type RevgasSaleInput,
  RevgasSaleInputSchema,
  RevgasSaleSchema,
} from '../revgas.schemas';
import type { RevgasHttp } from './revgas-http';

const PAGE_SIZE = 100;

export class HttpRevgasClient implements RevgasClient {
  constructor(
    private readonly http: RevgasHttp,
    private readonly establishmentId: number,
  ) {}

  listEstablishments(): Promise<Page<RevgasEstablishment>> {
    return this.http.request({
      method: 'GET',
      path: '/establishments',
      schema: pageSchema(RevgasEstablishmentSchema),
    });
  }

  listProducts(query: ListProductsQuery = {}): Promise<Page<RevgasProduct>> {
    return this.http.request({
      method: 'GET',
      path: '/products',
      query: { inactive: false, ...query, establishment_id: this.establishmentId },
      schema: pageSchema(RevgasProductSchema),
    });
  }

  listDeals(query: ListDealsQuery = {}): Promise<Page<RevgasDeal>> {
    return this.http.request({
      method: 'GET',
      path: '/deals',
      query: { ...query, establishment_id: this.establishmentId },
      schema: pageSchema(RevgasDealSchema),
    });
  }

  async listAllDeals(
    query: Omit<ListDealsQuery, 'page' | 'page_size'> = {},
  ): Promise<RevgasDeal[]> {
    const deals: RevgasDeal[] = [];
    for (let page = 1; ; page++) {
      const result = await this.listDeals({ ...query, page, page_size: PAGE_SIZE });
      deals.push(...result.data);
      const { has_next, total_count } = result.pagination;
      const hasNext = has_next ?? page * PAGE_SIZE < total_count;
      if (!hasNext || result.data.length === 0) {
        return deals;
      }
    }
  }

  async listPaymentTypes(): Promise<RevgasPaymentType[]> {
    const result = await this.http.request({
      method: 'GET',
      path: '/payment-types',
      query: { establishment_id: this.establishmentId, status: 'ACTIVE', page_size: PAGE_SIZE },
      schema: pageSchema(RevgasPaymentTypeSchema),
    });
    return result.data;
  }

  async findCustomersByPhone(phone: string): Promise<RevgasCustomer[]> {
    const result = await this.http.request({
      method: 'GET',
      path: '/customers',
      query: { phone: phone.replace(/\D/g, '') },
      schema: pageSchema(RevgasCustomerSchema),
    });
    return result.data;
  }

  getCustomer(id: number): Promise<RevgasCustomer> {
    return this.http.request({
      method: 'GET',
      path: `/customers/${id}`,
      schema: RevgasCustomerSchema,
    });
  }

  createCustomer(input: RevgasCustomerInput): Promise<RevgasCustomer> {
    return this.http.request({
      method: 'POST',
      path: '/customers',
      body: input,
      schema: RevgasCustomerSchema,
    });
  }

  updateCustomer(id: number, input: RevgasCustomerInput): Promise<RevgasCustomer> {
    return this.http.request({
      method: 'PUT',
      path: `/customers/${id}`,
      body: input,
      schema: RevgasCustomerSchema,
    });
  }

  createSale(input: RevgasSaleInput): Promise<RevgasSale> {
    const parsed = RevgasSaleInputSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.reject(
        new RevgasValidationError(
          'invalid sale input',
          parsed.error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        ),
      );
    }
    return this.http.request({
      method: 'POST',
      path: '/sales',
      body: { ...parsed.data, establishment_id: this.establishmentId },
      schema: RevgasSaleSchema,
    });
  }

  getSale(id: number): Promise<RevgasSale> {
    return this.http.request({ method: 'GET', path: `/sales/${id}`, schema: RevgasSaleSchema });
  }

  listSales(query: ListSalesQuery = {}): Promise<Page<RevgasSale>> {
    return this.http.request({
      method: 'GET',
      path: '/sales',
      query: { ...query, establishment_id: this.establishmentId },
      schema: pageSchema(RevgasSaleSchema),
    });
  }

  cancelSale(id: number, motiveCancelSaleId?: number | null): Promise<RevgasSale> {
    return this.http.request({
      method: 'PUT',
      path: `/sales/${id}/cancel`,
      body: { motive_cancel_sale_id: motiveCancelSaleId ?? null },
      schema: RevgasSaleSchema,
    });
  }
}
