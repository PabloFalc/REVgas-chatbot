import { isNull } from 'drizzle-orm';

export const notDeleted = (table: { deletedAt: unknown }) =>
  isNull(table.deletedAt as Parameters<typeof isNull>[0]);
