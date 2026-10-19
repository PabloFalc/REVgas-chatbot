import { type Column, inArray } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from 'src/infra/database/drizzle-client';

export async function deleteBy<T extends Column>(
  table: PgTable,
  column: T,
  values: readonly T['_']['data'][],
): Promise<void> {
  if (!values.length) return;
  await db.delete(table).where(inArray(column, values));
}
