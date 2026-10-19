import { relations } from 'drizzle-orm';
import { index, pgTable } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { users } from './users.table';

// ! BETTER-AUTH
export const sessions = pgTable(
  'sessions',
  t => ({
    id: t
      .text('id')
      .$defaultFn(() => uuidv7())
      .primaryKey(),
    expiresAt: t.timestamp('expires_at', { mode: 'string' }).notNull(),
    token: t.text('token').notNull().unique(),
    createdAt: t.timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: t
      .timestamp('updated_at', { mode: 'string' })
      .$onUpdate(() => /* @__PURE__ */ new Date().toISOString())
      .notNull(),
    ipAddress: t.text('ip_address'),
    userAgent: t.text('user_agent'),
    userId: t
      .text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  }),

  table => [index('sessions_userId_idx').on(table.userId)],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  users: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));
