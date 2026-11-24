import { bigint, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const botEvents = pgTable(
  'bot_events',
  {
    id: bigint({ mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    name: text().notNull(),
    cycleId: uuid('cycle_id'),
    prevStep: text('prev_step'),
    step: text(),
    outcome: text(),
    reason: text(),
    durationMs: integer('duration_ms'),
    amount: integer(),
  },
  table => [
    index('bot_events_occurred_at_idx').on(table.occurredAt),
    index('bot_events_name_occurred_at_idx').on(table.name, table.occurredAt),
    index('bot_events_cycle_id_idx').on(table.cycleId),
  ],
);
