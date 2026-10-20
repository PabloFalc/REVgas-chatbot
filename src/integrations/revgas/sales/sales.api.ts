import type { Page, PageQuery } from '../shared/pagination';
import type { RevgasSale, RevgasSaleInput } from './sales.schemas';

export type ListSalesQuery = PageQuery & {
  customer_id?: number;
  channel?: string;
  status?: string;
  from?: string;
  to?: string;
};

export interface SalesApi {
  create(input: RevgasSaleInput): Promise<RevgasSale>;
  get(id: number): Promise<RevgasSale>;
  list(query?: ListSalesQuery): Promise<Page<RevgasSale>>;
  cancel(id: number, motiveCancelSaleId?: number | null): Promise<RevgasSale>;
}
