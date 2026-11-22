import { z } from 'zod';

export const RevgasEstablishmentSchema = z.looseObject({
  id: z.number(),
  name: z.string().nullish(),
  display_name: z.string().nullish(),
  accept_order: z.boolean().optional(),
  ignore_stock_check: z.boolean().optional(),
  allow_vale_gas: z.boolean().optional(),
});
export type RevgasEstablishment = z.infer<typeof RevgasEstablishmentSchema>;
