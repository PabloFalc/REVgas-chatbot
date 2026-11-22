import { type Page, paginate } from '../shared/pagination';
import type { ListProductsQuery, ProductsApi } from './products.api';
import { FAKE_PRODUCTS } from './products.fixtures';
import type { RevgasProduct } from './products.schemas';

export class ProductsFake implements ProductsApi {
  async list(query: ListProductsQuery = {}): Promise<Page<RevgasProduct>> {
    const { page, page_size, inactive, description } = query;
    const items = FAKE_PRODUCTS.filter(
      product =>
        (inactive === undefined || Boolean(product.inactive) === inactive) &&
        (!description || product.description.toLowerCase().includes(description.toLowerCase())),
    );
    return paginate(items, { page, page_size });
  }
}
