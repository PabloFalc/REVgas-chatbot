import { FAKE_ID_START } from '../shared/fake-id';
import type { RevgasEstablishment } from './establishments.schemas';

export const FAKE_ESTABLISHMENT: RevgasEstablishment = {
  id: FAKE_ID_START + 1,
  name: 'Revenda Demo',
  display_name: 'Revenda Demo',
  accept_order: true,
  ignore_stock_check: true,
  allow_vale_gas: false,
};
