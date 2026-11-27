import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from '../shared/timestamps';

export const saleAttempts = pgTable(
  'sale_attempts',
  {
    id: uuid().primaryKey().defaultRandom(),
    cycleId: uuid('cycle_id').notNull(),
    status: text().notNull(),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
    productCode: text('product_code').notNull(),
    paymentMethodCode: text('payment_method_code').notNull(),
    customerSegment: text('customer_segment').notNull(),
    errorKind: text('error_kind'),
    isSimulated: boolean('is_simulated').notNull(),
    customerId: integer('customer_id').notNull(),
    erpSaleId: integer('erp_sale_id'),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  table => [
    uniqueIndex('sale_attempts_cycle_id_key').on(table.cycleId),
    index('sale_attempts_status_updated_at_idx').on(table.status, table.updatedAt),
  ],
);
