import { relations } from 'drizzle-orm';
import { index, pgTable } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { users } from './users.table';

export const accounts = pgTable(
  'accounts',
  t => ({
    id: t
      .text('id')
      .$defaultFn(() => uuidv7())
      .primaryKey(),
    accountId: t.text('account_id').notNull(),
    providerId: t.text('provider_id').notNull(),
    userId: t
      .text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: t.text('access_token'),
    refreshToken: t.text('refresh_token'),
    idToken: t.text('id_token'),
    accessTokenExpiresAt: t.timestamp('access_token_expires_at', { mode: 'string' }),
    refreshTokenExpiresAt: t.timestamp('refresh_token_expires_at', { mode: 'string' }),
    scope: t.text('scope'),
    password: t.text('password'),
    createdAt: t.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: t
      .timestamp('updated_at', { mode: 'string' })
      .$onUpdate(() => /* @__PURE__ */ new Date().toISOString())
      .notNull(),
  }),

  table => [index('accounts_userId_idx').on(table.userId)],
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  users: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));
