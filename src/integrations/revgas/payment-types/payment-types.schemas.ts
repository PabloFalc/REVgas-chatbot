import { z } from 'zod';
import { openEnum } from '../shared/open-enum';

export const PAYMENT_TYPES = [
  'MONEY',
  'WALLET',
  'BANKDRAFT',
  'FETLOCK',
  'VISA',
  'MASTER',
  'HIPER',
  'CREDISHOP',
  'VALEGAS',
  'ELO',
  'CARTAO_DE_CREDITO',
  'CARTAO_OUTRO',
  'CREDITO_CLIENTE',
  'CARTAO_DE_DEBITO',
  'CARTAO_REVGAS',
  'PIX',
  'TRANSFERENCIA_BANCARIA',
  'GAS_DO_POVO',
] as const;

export const RevgasPaymentTypeSchema = z.looseObject({
  id: z.number(),
  payment_type: openEnum(PAYMENT_TYPES),
  status: z.string().nullish(),
});
export type RevgasPaymentType = z.infer<typeof RevgasPaymentTypeSchema>;
