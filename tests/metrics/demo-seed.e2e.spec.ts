import { randomUUID } from 'node:crypto';
import { and, between, count, eq, inArray } from 'drizzle-orm';
import { DEMO_ID_MAX, DEMO_ID_MIN, generateDemoData } from 'src/cli/metrics-seed-demo.data';
import { clearDemo, replaceDemo } from 'src/cli/metrics-seed-demo.store';
import { closeDatabasePool, db } from 'src/infra/database/drizzle-client';
import { botEvents, saleAttempts } from 'src/infra/database/schemas';

describe('Seed de demonstração (e2e)', () => {
  const alienCycle = randomUUID();
  const realLookingCycle = `${DEMO_ID_MIN.slice(0, -12)}${'f'.repeat(11)}0`;
  const alienSale = randomUUID();
  const data = generateDemoData(new Date());

  const demoEvents = () =>
    db
      .select({ n: count() })
      .from(botEvents)
      .where(between(botEvents.cycleId, DEMO_ID_MIN, DEMO_ID_MAX))
      .then(([row]) => row.n);
  const demoSales = () =>
    db
      .select({ n: count() })
      .from(saleAttempts)
      .where(between(saleAttempts.cycleId, DEMO_ID_MIN, DEMO_ID_MAX))
      .then(([row]) => row.n);
  const totals = async () => ({
    events: (await db.select({ n: count() }).from(botEvents))[0].n,
    sales: (await db.select({ n: count() }).from(saleAttempts))[0].n,
  });

  beforeAll(async () => {
    await clearDemo(db);
    await db.insert(botEvents).values([
      { name: 'turn', cycleId: alienCycle, isSimulated: true },
      { name: 'turn', cycleId: realLookingCycle, isSimulated: false },
    ]);
    await db.insert(saleAttempts).values({
      cycleId: alienSale,
      status: 'registered',
      totalCents: 1,
      productCode: 'alien',
      paymentMethodCode: 'PIX',
      customerSegment: 'unknown',
      isSimulated: true,
      customerId: 0,
    });
  });

  afterAll(async () => {
    await clearDemo(db);
    await db.delete(botEvents).where(inArray(botEvents.cycleId, [alienCycle, realLookingCycle]));
    await db.delete(saleAttempts).where(eq(saleAttempts.cycleId, alienSale));
    await closeDatabasePool();
  });

  it('insere e substitui a demonstração sem duplicar nem tocar linhas alheias', async () => {
    const before = await totals();
    await replaceDemo(db, data);
    await replaceDemo(db, data);
    expect(await demoEvents()).toBe(data.events.length + 1);
    expect(await demoSales()).toBe(data.sales.length);
    const [{ n: real }] = await db
      .select({ n: count() })
      .from(botEvents)
      .where(
        and(eq(botEvents.isSimulated, false), between(botEvents.cycleId, DEMO_ID_MIN, DEMO_ID_MAX)),
      );
    expect(real).toBe(1);
    expect(await totals()).toEqual({
      events: before.events + data.events.length,
      sales: before.sales + data.sales.length,
    });
  });

  it('--clear remove só a demonstração simulada', async () => {
    await replaceDemo(db, data);
    const before = await totals();
    const removed = await clearDemo(db);
    expect(removed).toEqual({ events: data.events.length, sales: data.sales.length });
    expect(await totals()).toEqual({
      events: before.events - data.events.length,
      sales: before.sales - data.sales.length,
    });
    const alien = await db.select().from(botEvents).where(eq(botEvents.cycleId, alienCycle));
    expect(alien).toHaveLength(1);
    const realRow = await db
      .select()
      .from(botEvents)
      .where(eq(botEvents.cycleId, realLookingCycle));
    expect(realRow).toHaveLength(1);
    expect(
      await db.select().from(saleAttempts).where(eq(saleAttempts.cycleId, alienSale)),
    ).toHaveLength(1);
  });
});
