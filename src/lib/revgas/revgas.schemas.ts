import { z } from 'zod';

export const openEnum = <const T extends readonly string[]>(_values: T) =>
  z.string().transform(value => value as T[number] | (string & {}));

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

export const SALE_STATUSES = ['CANCEL', 'OPEN', 'ACTIVE', 'WARNING', 'CONFIRM', 'CHECK'] as const;

export const SALE_CHANNELS = ['DISK', 'SINO', 'WHATSAPP'] as const;

export const RevgasPaginationSchema = z.object({
  page: z.number(),
  count: z.number(),
  total_count: z.number(),
  page_size: z.number().optional(),
  has_next: z.boolean().optional(),
});
export type RevgasPagination = z.infer<typeof RevgasPaginationSchema>;

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), pagination: RevgasPaginationSchema });

export const RevgasEstablishmentSchema = z.looseObject({
  id: z.number(),
  name: z.string().nullish(),
  display_name: z.string().nullish(),
  accept_order: z.boolean().optional(),
  ignore_stock_check: z.boolean().optional(),
  allow_vale_gas: z.boolean().optional(),
});
export type RevgasEstablishment = z.infer<typeof RevgasEstablishmentSchema>;

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

export const RevgasPaymentTypeSchema = z.looseObject({
  id: z.number(),
  payment_type: openEnum(PAYMENT_TYPES),
  status: z.string().nullish(),
});
export type RevgasPaymentType = z.infer<typeof RevgasPaymentTypeSchema>;

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

export const RevgasSaleProductSchema = z.looseObject({
  product_id: z.number(),
  quantity: z.number(),
  value: z.number(),
  discount: z.number().nullish(),
  product_description: z.string().nullish(),
});
export type RevgasSaleProduct = z.infer<typeof RevgasSaleProductSchema>;

export const RevgasSalePaymentSchema = z.looseObject({
  payment_type: openEnum(PAYMENT_TYPES),
  value: z.number(),
});
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
  lat: z.number().optional(),
  lon: z.number().optional(),
  customer_id: z.number().optional(),
  observation: z.string().optional(),
  channel: z.string().default('WHATSAPP'),
  origin: z.enum(['ENTREGA', 'REVGAS', 'INTEGRATION']).optional(),
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
