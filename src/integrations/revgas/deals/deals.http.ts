import { PAGE_SIZE, type Page, pageSchema } from '../shared/pagination';
import type { RevgasHttp } from '../shared/revgas-http';
import type { DealsApi, ListAllDealsQuery, ListDealsQuery } from './deals.api';
import { type RevgasDeal, RevgasDealSchema } from './deals.schemas';

export class DealsHttp implements DealsApi {
  constructor(
    private readonly http: RevgasHttp,
    private readonly establishmentId: number,
  ) {}

  list(query: ListDealsQuery = {}): Promise<Page<RevgasDeal>> {
    return this.http.request({
      method: 'GET',
      path: '/deals',
      query: { ...query, establishment_id: this.establishmentId },
      schema: pageSchema(RevgasDealSchema),
    });
  }

  async listAll(query: ListAllDealsQuery = {}): Promise<RevgasDeal[]> {
    const deals: RevgasDeal[] = [];
    for (let page = 1; ; page++) {
      const result = await this.list({ ...query, page, page_size: PAGE_SIZE });
      deals.push(...result.data);
      const { has_next, total_count } = result.pagination;
      const hasNext = has_next ?? page * PAGE_SIZE < total_count;
      if (!hasNext || result.data.length === 0) {
        return deals;
      }
    }
  }
}
