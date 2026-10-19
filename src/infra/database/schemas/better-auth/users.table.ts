import { relations } from 'drizzle-orm';
import { index, pgTable } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { accounts } from '../better-auth/accounts.table';
import { timestamps } from '../shared/timestamps';
import { sessions } from './sessions.table';

export const users = pgTable(
  'users',
  t => ({
    id: t
      .text('id')
      .$defaultFn(() => uuidv7())
      .primaryKey(),
    userName: t.varchar('user_name', { length: 50 }).unique().notNull(),
    name: t.varchar('name', { length: 255 }).notNull(),
    email: t.varchar('email', { length: 255 }).unique().notNull(),
    emailVerified: t.boolean('email_verified').default(false).notNull(),
    image: t.text('image'),
    ...timestamps,
  }),
  table => [index('users_created_at').on(table.createdAt)],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
}));
