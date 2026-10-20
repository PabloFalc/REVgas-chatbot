import type {
  RevgasCustomer,
  RevgasDeal,
  RevgasEstablishment,
  RevgasPaymentType,
  RevgasProduct,
} from '../revgas.schemas';

export const FAKE_ID_START = 900_000_000;

export const FAKE_ESTABLISHMENT: RevgasEstablishment = {
  id: FAKE_ID_START + 1,
  name: 'Revenda Demo',
  display_name: 'Revenda Demo',
  accept_order: true,
  ignore_stock_check: true,
  allow_vale_gas: false,
};

export const FAKE_PRODUCTS: RevgasProduct[] = [
  {
    id: FAKE_ID_START + 101,
    description: 'GLP 13KG',
    stock_quantity: 100,
    inactive: false,
    container_id: FAKE_ID_START + 104,
    establishment_id: FAKE_ESTABLISHMENT.id,
  },
  {
    id: FAKE_ID_START + 102,
    description: 'GLP 45KG',
    stock_quantity: 50,
    inactive: false,
    establishment_id: FAKE_ESTABLISHMENT.id,
  },
  {
    id: FAKE_ID_START + 103,
    description: 'AGUA 20L',
    stock_quantity: 80,
    inactive: false,
    establishment_id: FAKE_ESTABLISHMENT.id,
  },
  {
    id: FAKE_ID_START + 104,
    description: 'VASILHAME 13KG',
    stock_quantity: 200,
    inactive: false,
    establishment_id: FAKE_ESTABLISHMENT.id,
  },
];

export const FAKE_PAYMENT_TYPES: RevgasPaymentType[] = [
  { id: FAKE_ID_START + 201, payment_type: 'MONEY', status: 'ACTIVE' },
  { id: FAKE_ID_START + 202, payment_type: 'PIX', status: 'ACTIVE' },
  { id: FAKE_ID_START + 203, payment_type: 'CARTAO_DE_CREDITO', status: 'ACTIVE' },
  { id: FAKE_ID_START + 204, payment_type: 'CARTAO_DE_DEBITO', status: 'ACTIVE' },
];

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

export const FAKE_CUSTOMERS: RevgasCustomer[] = [
  {
    id: FAKE_ID_START + 401,
    name: 'Cliente Demo Um',
    cpf: '00000000191',
    phones: ['5586900000001'],
    location: 'Rua Exemplo',
    number: '100',
    neighborhood: 'Centro',
    city: 'Teresina',
    state_federation: 'PI',
    tag_id: 3519,
  },
  {
    id: FAKE_ID_START + 402,
    name: 'Cliente Demo Dois',
    cpf: '00000000272',
    phones: ['5586900000002'],
    location: 'Avenida Modelo',
    number: '200',
    neighborhood: 'Fatima',
    city: 'Teresina',
    state_federation: 'PI',
  },
];
