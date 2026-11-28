import { and, between, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../infra/database/schemas';
import { botEvents } from '../infra/database/schemas/metrics/bot-events.table';
import { saleAttempts } from '../infra/database/schemas/order/sale-attempts.table';
import { DEMO_ID_MAX, DEMO_ID_MIN, type DemoData } from './metrics-seed-demo.data';

type Db = NodePgDatabase<typeof schema>;

const CHUNK = 1000;

async function removeDemo(tx: Pick<Db, 'delete'>): Promise<{ events: number; sales: number }> {
  const events = await tx
    .delete(botEvents)
    .where(
      and(eq(botEvents.isSimulated, true), between(botEvents.cycleId, DEMO_ID_MIN, DEMO_ID_MAX)),
    )
    .returning({ id: botEvents.id });
  const sales = await tx
    .delete(saleAttempts)
    .where(
      and(
        eq(saleAttempts.isSimulated, true),
        between(saleAttempts.cycleId, DEMO_ID_MIN, DEMO_ID_MAX),
      ),
    )
    .returning({ id: saleAttempts.id });
  return { events: events.length, sales: sales.length };
}

export function clearDemo(db: Db): Promise<{ events: number; sales: number }> {
  return db.transaction(tx => removeDemo(tx));
}

export async function replaceDemo(db: Db, data: DemoData): Promise<void> {
  await db.transaction(async tx => {
    await removeDemo(tx);
    for (let i = 0; i < data.events.length; i += CHUNK) {
      await tx
        .insert(botEvents)
        .values(
          data.events
            .slice(i, i + CHUNK)
            .map(({ event, occurredAt }) => ({ ...event, isSimulated: true, occurredAt })),
        );
    }
    for (let i = 0; i < data.sales.length; i += CHUNK) {
      await tx.insert(saleAttempts).values(
        data.sales.slice(i, i + CHUNK).map(sale => {
          const createdAt = sale.createdAt.toISOString();
          return { ...sale, createdAt, updatedAt: createdAt };
        }),
      );
    }
  });
}
