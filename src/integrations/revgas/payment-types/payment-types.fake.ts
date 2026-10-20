import type { RevgasDeal } from '../deals/deals.schemas';
import { clone } from '../shared/clone';
import type { PaymentTypesApi } from './payment-types.api';
import { FAKE_PAYMENT_TYPES } from './payment-types.fixtures';
import type { RevgasPaymentType } from './payment-types.schemas';

export type DealsSource = () => Promise<RevgasDeal[]>;

export class PaymentTypesFake implements PaymentTypesApi {
  constructor(private readonly dealsSource?: DealsSource) {}

  async list(): Promise<RevgasPaymentType[]> {
    if (!this.dealsSource) {
      return clone(FAKE_PAYMENT_TYPES);
    }
    const unique = new Map<number, RevgasPaymentType>();
    for (const deal of await this.dealsSource()) {
      const id = deal.payment_type_establishment_id;
      if (id !== null && id !== undefined && !unique.has(id)) {
        unique.set(id, { id, payment_type: deal.payment_type, status: 'ACTIVE' });
      }
    }
    return [...unique.values()];
  }
}
