import type { Page, PageQuery } from '../shared/pagination';
import type { RevgasProduct } from './products.schemas';

export type ListProductsQuery = PageQuery & { inactive?: boolean; description?: string };

export interface ProductsApi {
  list(query?: ListProductsQuery): Promise<Page<RevgasProduct>>;
}
