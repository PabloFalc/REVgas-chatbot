import { clone } from '../shared/fake';
import { type Page, paginate } from '../shared/pagination';
import type { DealsApi, ListAllDealsQuery, ListDealsQuery } from './deals.api';
import { FAKE_DEALS } from './deals.fixtures';
import type { RevgasDeal } from './deals.schemas';

export class DealsFake implements DealsApi {
  async list(query: ListDealsQuery = {}): Promise<Page<RevgasDeal>> {
    const { page, page_size, ...filters } = query;
    return paginate(this.filter(filters), { page, page_size });
  }

  async listAll(query: ListAllDealsQuery = {}): Promise<RevgasDeal[]> {
    return clone(this.filter(query));
  }

  private filter(filters: ListAllDealsQuery): RevgasDeal[] {
    return FAKE_DEALS.filter(
      deal =>
        (filters.product_id === undefined || deal.product_id === filters.product_id) &&
        (filters.customer_id === undefined || deal.customer_id === filters.customer_id) &&
        (filters.tag_id === undefined || deal.tag_id === filters.tag_id) &&
        (filters.payment_type === undefined || deal.payment_type === filters.payment_type),
    );
  }
}
