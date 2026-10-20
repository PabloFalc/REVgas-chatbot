import { FAKE_PAYMENT_TYPES } from '../payment-types/payment-types.fixtures';
import { FAKE_PRODUCTS } from '../products/products.fixtures';
import type { RevgasProduct } from '../products/products.schemas';
import { FAKE_ID_START } from '../shared/fake-id';
import type { RevgasDeal } from './deals.schemas';

const paymentTypeId = (type: string): number =>
  FAKE_PAYMENT_TYPES.find(item => item.payment_type === type)?.id ?? FAKE_ID_START + 200;

const baseDeal = (
  id: number,
  product: RevgasProduct,
  payment: string,
  value: number,
): RevgasDeal => ({
  id: FAKE_ID_START + id,
  product_id: product.id,
  product_description: product.description,
  suggested_value: value,
  minimum_value: value,
  payment_type: payment,
  payment_type_establishment_id: paymentTypeId(payment),
  type: 'PAYMENT_TYPE',
  is_default: true,
});

const [GLP13, GLP45, AGUA] = FAKE_PRODUCTS;

export const FAKE_DEALS: RevgasDeal[] = [
  baseDeal(301, GLP13, 'PIX', 125),
  baseDeal(302, GLP13, 'MONEY', 125),
  baseDeal(303, GLP13, 'CARTAO_DE_DEBITO', 125),
  baseDeal(304, GLP13, 'CARTAO_DE_CREDITO', 133),
  baseDeal(305, GLP45, 'PIX', 520),
  baseDeal(306, GLP45, 'MONEY', 520),
  baseDeal(307, AGUA, 'PIX', 12),
  baseDeal(308, AGUA, 'MONEY', 12),
  {
    id: FAKE_ID_START + 309,
    product_id: GLP13.id,
    product_description: GLP13.description,
    suggested_value: 85,
    minimum_value: 85,
    payment_type: 'MONEY',
    payment_type_establishment_id: paymentTypeId('MONEY'),
    type: 'TAG',
    tag_id: 3519,
    is_default: false,
  },
];
