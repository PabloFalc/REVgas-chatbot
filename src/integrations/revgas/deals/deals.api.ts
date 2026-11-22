import type { Page, PageQuery } from '../shared/pagination';
import type { RevgasDeal } from './deals.schemas';

export type ListDealsQuery = PageQuery & {
  product_id?: number;
  customer_id?: number;
  tag_id?: number;
  payment_type?: string;
};

export type ListAllDealsQuery = Omit<ListDealsQuery, 'page' | 'page_size'>;

export interface DealsApi {
  list(query?: ListDealsQuery): Promise<Page<RevgasDeal>>;
  listAll(query?: ListAllDealsQuery): Promise<RevgasDeal[]>;
}
