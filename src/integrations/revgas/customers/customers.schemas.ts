import { z } from 'zod';

const customerFields = {
  name: z.string().nullish(),
  cpf: z.string().nullish(),
  phones: z.array(z.string()).optional(),
  location: z.string().nullish(),
  number: z.string().nullish(),
  neighborhood: z.string().nullish(),
  city: z.string().nullish(),
  state_federation: z.string().nullish(),
  complement: z.string().nullish(),
  landmark: z.string().nullish(),
  postal_code: z.string().nullish(),
  tag_id: z.number().nullish(),
};

export const RevgasCustomerSchema = z.looseObject({
  id: z.number(),
  ...customerFields,
  last_sale: z.unknown().optional(),
});
export type RevgasCustomer = z.infer<typeof RevgasCustomerSchema>;

export const RevgasCustomerInputSchema = z.object(customerFields);
export type RevgasCustomerInput = z.input<typeof RevgasCustomerInputSchema>;
