import type { RevgasDeal } from 'src/integrations/revgas/deals/deals.schemas';
import type { PriceCustomer } from './contracts/catalog.types';

const isBase = (deal: RevgasDeal): boolean =>
  (deal.type === undefined || deal.type === 'PAYMENT_TYPE') &&
  deal.customer_id == null &&
  deal.tag_id == null;

export function pickDeal(
  deals: RevgasDeal[],
  productId: number,
  paymentType: string,
  customer: PriceCustomer,
): RevgasDeal | null {
  const candidates = deals.filter(
    deal => deal.product_id === productId && deal.payment_type === paymentType,
  );

  const ofCustomer = candidates.find(
    deal => deal.type === 'CUSTOMER' && customer.id != null && deal.customer_id === customer.id,
  );
  if (ofCustomer) return ofCustomer;

  const ofTag = candidates.find(
    deal => deal.type === 'TAG' && customer.tagId != null && deal.tag_id === customer.tagId,
  );
  if (ofTag) return ofTag;

  const bases = candidates.filter(isBase);
  return bases.find(deal => deal.is_default === true) ?? bases[0] ?? null;
}
