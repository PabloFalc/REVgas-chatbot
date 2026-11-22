import { z } from 'zod';

export const RevgasProductSchema = z.looseObject({
  id: z.number(),
  description: z.string(),
  stock_quantity: z.number().nullish(),
  inactive: z.boolean().optional(),
  container_id: z.number().nullish(),
  revgas_product_id: z.number().nullish(),
  establishment_id: z.number().nullish(),
});
export type RevgasProduct = z.infer<typeof RevgasProductSchema>;
