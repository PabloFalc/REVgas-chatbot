import { z } from 'zod';
import { PAYMENT_TYPES } from '../payment-types/payment-types.schemas';
import { openEnum } from '../shared/open-enum';
import { parseInput } from '../shared/validation';

export const SALE_STATUSES = ['CANCEL', 'OPEN', 'ACTIVE', 'WARNING', 'CONFIRM', 'CHECK'] as const;

export const SALE_CHANNELS = ['DISK', 'SINO', 'WHATSAPP'] as const;

export const RevgasSaleProductSchema = z.looseObject({
  product_id: z.number(),
  quantity: z.number(),
  value: z.number(),
  discount: z.number().nullish(),
  product_description: z.string().nullish(),
});
export type RevgasSaleProduct = z.infer<typeof RevgasSaleProductSchema>;

export const RevgasSalePaymentSchema = z.union([
  z.looseObject({ payment_type: openEnum(PAYMENT_TYPES), value: z.number() }),
  z.looseObject({ type: openEnum(PAYMENT_TYPES), value: z.number() }).transform(payment => ({
    ...payment,
    payment_type: payment.type,
  })),
]);
export type RevgasSalePayment = z.infer<typeof RevgasSalePaymentSchema>;

export const RevgasSaleSchema = z.looseObject({
  id: z.number(),
  status: openEnum(SALE_STATUSES),
  channel: openEnum(SALE_CHANNELS).nullish(),
  total: z.number().nullish(),
  customer_id: z.number().nullish(),
  customer_name: z.string().nullish(),
  deliverer_id: z.number().nullish(),
  deliverer_name: z.string().nullish(),
  delivered_at: z.string().nullish(),
  date: z.string().nullish(),
  created_at: z.string().nullish(),
  location: z.string().nullish(),
  number: z.string().nullish(),
  neighborhood: z.string().nullish(),
  city: z.string().nullish(),
  state_federation: z.string().nullish(),
  complement: z.string().nullish(),
  landmark: z.string().nullish(),
  observation: z.string().nullish(),
  products: z.array(RevgasSaleProductSchema).optional(),
  payments: z.array(RevgasSalePaymentSchema).optional(),
  lat: z.union([z.string(), z.number()]).nullish(),
  lon: z.union([z.string(), z.number()]).nullish(),
  establishment_id: z.number().nullish(),
});
export type RevgasSale = z.infer<typeof RevgasSaleSchema>;

export const RevgasSaleInputSchema = z.object({
  location: z.string().min(1),
  number: z.string().min(1),
  neighborhood: z.string().min(1),
  city: z.string().min(1),
  state_federation: z.string().min(1),
  complement: z.string().optional(),
  landmark: z.string().optional(),
  lat: z.union([z.string(), z.number()]).optional(),
  lon: z.union([z.string(), z.number()]).optional(),
  customer_id: z.number().optional(),
  observation: z.string().optional(),
  channel: z.string().default('WHATSAPP'),
  origin: z.enum(['ENTREGA', 'REVGAS', 'INTEGRATION']).optional(),
  option: z.enum(['INDOOR', 'OUTDOOR', 'NORMAL']),
  broadcast: z.enum(['OLD_SALE', 'NEW_SALE', 'NONE']).optional(),
  products: z
    .array(
      z.object({
        product_id: z.number(),
        quantity: z.number().int().min(1),
        value: z.number().positive(),
        discount: z.number().optional(),
        product_description: z.string().optional(),
      }),
    )
    .min(1),
  payments: z.array(z.object({ payment_type: z.string(), value: z.number().positive() })).min(1),
});
export type RevgasSaleInput = z.input<typeof RevgasSaleInputSchema>;

export const parseSaleInput = (input: RevgasSaleInput) =>
  parseInput(RevgasSaleInputSchema, input, 'invalid sale input');
