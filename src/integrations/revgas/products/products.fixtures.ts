import { FAKE_ESTABLISHMENT } from '../establishments/establishments.fixtures';
import { FAKE_ID_START } from '../shared/fake';
import type { RevgasProduct } from './products.schemas';

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
