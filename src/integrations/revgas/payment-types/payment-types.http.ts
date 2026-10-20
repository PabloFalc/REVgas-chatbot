import { PAGE_SIZE, pageSchema } from '../shared/pagination';
import type { RevgasHttp } from '../shared/revgas-http';
import type { PaymentTypesApi } from './payment-types.api';
import { type RevgasPaymentType, RevgasPaymentTypeSchema } from './payment-types.schemas';

export class PaymentTypesHttp implements PaymentTypesApi {
  constructor(
    private readonly http: RevgasHttp,
    private readonly establishmentId: number,
  ) {}

  async list(): Promise<RevgasPaymentType[]> {
    const result = await this.http.request({
      method: 'GET',
      path: '/payment-types',
      query: { establishment_id: this.establishmentId, status: 'ACTIVE', page_size: PAGE_SIZE },
      schema: pageSchema(RevgasPaymentTypeSchema),
    });
    return result.data;
  }
}
