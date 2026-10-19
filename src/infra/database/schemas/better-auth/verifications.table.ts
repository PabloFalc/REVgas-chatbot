import { index, pgTable } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

// ! BETTER-AUTH
export const verifications = pgTable(
  'verifications',
  t => ({
    id: t
      .text('id')
      .$defaultFn(() => uuidv7())
      .primaryKey(),
    identifier: t.text('identifier').notNull(),
    value: t.text('value').notNull(),
    expiresAt: t.timestamp('expires_at', { mode: 'string' }).notNull(),
    createdAt: t.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: t
      .timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date().toISOString())
      .notNull(),
  }),
  table => [index('verifications_identifier_idx').on(table.identifier)],
);
