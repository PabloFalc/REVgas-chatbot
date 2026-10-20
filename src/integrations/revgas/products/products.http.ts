import { type Page, pageSchema } from '../shared/pagination';
import type { RevgasHttp } from '../shared/revgas-http';
import type { ListProductsQuery, ProductsApi } from './products.api';
import { type RevgasProduct, RevgasProductSchema } from './products.schemas';

export class ProductsHttp implements ProductsApi {
  constructor(
    private readonly http: RevgasHttp,
    private readonly establishmentId: number,
  ) {}

  list(query: ListProductsQuery = {}): Promise<Page<RevgasProduct>> {
    return this.http.request({
      method: 'GET',
      path: '/products',
      query: { inactive: false, ...query, establishment_id: this.establishmentId },
      schema: pageSchema(RevgasProductSchema),
    });
  }
}
