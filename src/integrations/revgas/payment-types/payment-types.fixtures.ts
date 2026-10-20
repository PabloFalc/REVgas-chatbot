import { FAKE_ID_START } from '../shared/fake-id';
import type { RevgasPaymentType } from './payment-types.schemas';

export const FAKE_PAYMENT_TYPES: RevgasPaymentType[] = [
  { id: FAKE_ID_START + 201, payment_type: 'MONEY', status: 'ACTIVE' },
  { id: FAKE_ID_START + 202, payment_type: 'PIX', status: 'ACTIVE' },
  { id: FAKE_ID_START + 203, payment_type: 'CARTAO_DE_CREDITO', status: 'ACTIVE' },
  { id: FAKE_ID_START + 204, payment_type: 'CARTAO_DE_DEBITO', status: 'ACTIVE' },
];
