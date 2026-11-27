import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DatabaseModule } from 'src/infra/database/database.module';
import { DRIZZLE } from 'src/infra/database/drizzle-client';
import type * as schema from 'src/infra/database/schemas';
import { saleAttempts } from 'src/infra/database/schemas';
import {
  SaleAlreadyRegisteredError,
  type SaleAttemptInput,
  SaleAttemptStoreError,
  SaleUncertainError,
} from 'src/modules/order/contracts/order.types';
import { SaleAttemptsRepository } from 'src/modules/order/sale-attempts.repository';

describe('SaleAttemptsRepository (e2e)', () => {
  let moduleRef: TestingModule;
  let repository: SaleAttemptsRepository;
  let db: NodePgDatabase<typeof schema>;
  const cycles: string[] = [];

  function newCycle(): string {
    const cycleId = randomUUID();
    cycles.push(cycleId);
    return cycleId;
  }

  function attempt(cycleId: string): SaleAttemptInput {
    return {
      cycleId,
      customerId: 900001,
      totalCents: Math.round(110.5 * 100),
      productCode: '900000101',
      paymentMethodCode: 'PIX',
      customerSegment: 'recurring',
      isSimulated: true,
    };
  }

  function newCustomer(): number {
    return 800_000_000 + Math.floor(Math.random() * 99_999_999);
  }

  async function uncertainFor(customerId: number, isSimulated: boolean): Promise<string> {
    const cycleId = newCycle();
    await repository.begin({ ...attempt(cycleId), customerId, isSimulated });
    await repository.finish(cycleId, { status: 'uncertain', errorKind: 'timeout' });
    return cycleId;
  }

  const rowsOf = (cycleId: string) =>
    db.select().from(saleAttempts).where(eq(saleAttempts.cycleId, cycleId));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [SaleAttemptsRepository],
    }).compile();
    repository = moduleRef.get(SaleAttemptsRepository);
    db = moduleRef.get(DRIZZLE);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (cycles.length) await db.delete(saleAttempts).where(inArray(saleAttempts.cycleId, cycles));
    await moduleRef.close();
  });

  it('índice único impede duas tentativas no mesmo ciclo', async () => {
    const cycleId = newCycle();

    const results = await Promise.allSettled([
      repository.begin(attempt(cycleId)),
      repository.begin(attempt(cycleId)),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(SaleUncertainError);
    const rows = await rowsOf(cycleId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', totalCents: 11050, errorKind: null });
    await expect(
      db.insert(saleAttempts).values({ ...attempt(cycleId), status: 'pending' }),
    ).rejects.toThrow();

    await repository.finish(cycleId, { status: 'uncertain', errorKind: 'timeout' });
    await expect(repository.begin(attempt(cycleId))).rejects.toBeInstanceOf(SaleUncertainError);

    await repository.finish(cycleId, { status: 'registered', erpSaleId: 4321 });
    const registered = repository.begin(attempt(cycleId));
    await expect(registered).rejects.toBeInstanceOf(SaleAlreadyRegisteredError);
    await expect(registered).rejects.toMatchObject({ saleId: 4321 });
    expect(await repository.statusOf(cycleId)).toBe('registered');
    expect(await rowsOf(cycleId)).toHaveLength(1);
  });

  it('tentar de novo depois de failed reabre a mesma tentativa', async () => {
    const cycleId = newCycle();
    await repository.begin(attempt(cycleId));
    const [first] = await rowsOf(cycleId);
    await repository.finish(cycleId, { status: 'failed', errorKind: 'unauthorized' });
    expect(await repository.statusOf(cycleId)).toBe('failed');

    await repository.begin(attempt(cycleId));

    const rows = await rowsOf(cycleId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, status: 'pending', errorKind: null });

    await repository.finish(cycleId, { status: 'failed', errorKind: 'blocked' });
    const results = await Promise.allSettled([
      repository.begin(attempt(cycleId)),
      repository.begin(attempt(cycleId)),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await repository.statusOf(cycleId)).toBe('pending');
  });

  it('banco indisponível no begin lança SaleAttemptStoreError', async () => {
    const cycleId = newCycle();
    const insert = vi.spyOn(db, 'insert').mockImplementation(() => {
      throw new Error('conexão recusada');
    });

    await expect(repository.begin(attempt(cycleId))).rejects.toBeInstanceOf(SaleAttemptStoreError);

    insert.mockRestore();
    expect(await rowsOf(cycleId)).toHaveLength(0);
    expect(await repository.statusOf(randomUUID())).toBeNull();
  });

  it('recusa tentativa nova com incerta recente do mesmo cliente em outro ciclo', async () => {
    const customerId = newCustomer();
    await uncertainFor(customerId, true);
    const cycleId = newCycle();

    await expect(
      repository.begin({ ...attempt(cycleId), customerId, isSimulated: true }),
    ).rejects.toBeInstanceOf(SaleUncertainError);

    expect(await rowsOf(cycleId)).toHaveLength(0);
    const otherCustomer = newCycle();
    await repository.begin({ ...attempt(otherCustomer), customerId: newCustomer() });
    expect(await repository.statusOf(otherCustomer)).toBe('pending');
  });

  it('permite tentativa nova quando a incerta do mesmo cliente é mais antiga que a janela', async () => {
    const customerId = newCustomer();
    const old = await uncertainFor(customerId, true);
    await db
      .update(saleAttempts)
      .set({ updatedAt: sql`now() - interval '25 hours'` })
      .where(eq(saleAttempts.cycleId, old));
    const cycleId = newCycle();

    await repository.begin({ ...attempt(cycleId), customerId, isSimulated: true });

    expect(await repository.statusOf(cycleId)).toBe('pending');
  });

  it('tentativa simulada e tentativa real não se bloqueiam', async () => {
    const simulatedCustomer = newCustomer();
    await uncertainFor(simulatedCustomer, true);
    const real = newCycle();
    await repository.begin({ ...attempt(real), customerId: simulatedCustomer, isSimulated: false });
    expect(await repository.statusOf(real)).toBe('pending');

    const realCustomer = newCustomer();
    await uncertainFor(realCustomer, false);
    const simulated = newCycle();
    await repository.begin({ ...attempt(simulated), customerId: realCustomer, isSimulated: true });
    expect(await repository.statusOf(simulated)).toBe('pending');
  });

  it('varredura marca como incerta a tentativa pendente antiga', async () => {
    const customerId = newCustomer();
    const orphan = newCycle();
    const recent = newCycle();
    const registered = newCycle();
    await db.insert(saleAttempts).values([
      {
        ...attempt(orphan),
        customerId,
        status: 'pending',
        updatedAt: sql`now() - interval '2 minutes'`,
      },
      { ...attempt(recent), customerId, status: 'pending' },
      {
        ...attempt(registered),
        customerId,
        status: 'registered',
        erpSaleId: 5555,
        updatedAt: sql`now() - interval '2 minutes'`,
      },
    ]);
    const [recentBefore] = await rowsOf(recent);
    const [registeredBefore] = await rowsOf(registered);

    const swept = await repository.sweepStale();

    expect(swept).toContainEqual({ cycleId: orphan, isSimulated: true });
    expect(swept.map(row => row.cycleId)).not.toContain(recent);
    expect(swept.map(row => row.cycleId)).not.toContain(registered);
    const [orphanAfter] = await rowsOf(orphan);
    expect(orphanAfter).toMatchObject({
      status: 'uncertain',
      errorKind: 'restart',
      erpSaleId: null,
    });
    expect(await rowsOf(recent)).toEqual([recentBefore]);
    expect(await rowsOf(registered)).toEqual([registeredBefore]);

    const again = await repository.sweepStale();

    expect(again.map(row => row.cycleId)).not.toContain(orphan);
    expect(await rowsOf(orphan)).toEqual([orphanAfter]);
    expect(await rowsOf(recent)).toEqual([recentBefore]);
    expect(await rowsOf(registered)).toEqual([registeredBefore]);
  });
});
