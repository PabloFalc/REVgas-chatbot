import { type Page, pageSchema } from '../shared/pagination';
import type { RevgasHttp } from '../shared/revgas-http';
import type { ListSalesQuery, SalesApi } from './sales.api';
import {
  parseSaleInput,
  type RevgasSale,
  type RevgasSaleInput,
  RevgasSaleSchema,
} from './sales.schemas';

export class SalesHttp implements SalesApi {
  constructor(
    private readonly http: RevgasHttp,
    private readonly establishmentId: number,
  ) {}

  create(input: RevgasSaleInput): Promise<RevgasSale> {
    let parsed: ReturnType<typeof parseSaleInput>;
    try {
      parsed = parseSaleInput(input);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.http.request({
      method: 'POST',
      path: '/sales',
      body: { ...parsed, establishment_id: this.establishmentId },
      schema: RevgasSaleSchema,
    });
  }

  get(id: number): Promise<RevgasSale> {
    return this.http.request({ method: 'GET', path: `/sales/${id}`, schema: RevgasSaleSchema });
  }

  list(query: ListSalesQuery = {}): Promise<Page<RevgasSale>> {
    return this.http.request({
      method: 'GET',
      path: '/sales',
      query: {
        ...query,
        status: query.status === 'WARNING' ? 'WARN' : query.status,
        establishment_id: this.establishmentId,
      },
      schema: pageSchema(RevgasSaleSchema),
    });
  }

  cancel(id: number, motiveCancelSaleId?: number | null): Promise<RevgasSale> {
    return this.http.request({
      method: 'PUT',
      path: `/sales/${id}/cancel`,
      body: { motive_cancel_sale_id: motiveCancelSaleId ?? null },
      schema: RevgasSaleSchema,
    });
  }
}
