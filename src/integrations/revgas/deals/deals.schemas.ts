import { z } from 'zod';
import { PAYMENT_TYPES } from '../payment-types/payment-types.schemas';
import { openEnum } from '../shared/open-enum';

export const RevgasDealSchema = z.looseObject({
  id: z.number(),
  product_id: z.number(),
  suggested_value: z.number(),
  minimum_value: z.number(),
  payment_type: openEnum(PAYMENT_TYPES),
  payment_type_establishment_id: z.number().nullish(),
  type: openEnum(['PAYMENT_TYPE', 'TAG', 'CUSTOMER'] as const).optional(),
  tag_id: z.number().nullish(),
  customer_id: z.number().nullish(),
  is_default: z.boolean().optional(),
  product_description: z.string().nullish(),
});
export type RevgasDeal = z.infer<typeof RevgasDealSchema>;
