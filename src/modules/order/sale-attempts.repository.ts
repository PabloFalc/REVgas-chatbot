import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from 'src/infra/database/drizzle-client';
import type * as schema from 'src/infra/database/schemas';
import { saleAttempts } from 'src/infra/database/schemas/order/sale-attempts.table';
import {
  SaleAlreadyRegisteredError,
  type SaleAttemptInput,
  type SaleAttemptOutcome,
  type SaleAttemptStatus,
  SaleAttemptStoreError,
  SaleUncertainError,
} from './contracts/order.types';

export const STALE_ATTEMPT_SECONDS = 60;
const UNCERTAIN_GUARD_HOURS = 24;

type Existing = { status: SaleAttemptStatus; erpSaleId: number | null } | undefined;

@Injectable()
export class SaleAttemptsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>) {}

  async begin(attempt: SaleAttemptInput): Promise<void> {
    if (await this.store(() => this.hasRecentUncertain(attempt))) {
      throw new SaleUncertainError('Tentativa incerta recente do mesmo cliente em outro ciclo');
    }
    const existing = await this.store(() => this.claim(attempt));
    if (!existing) return;
    if (existing.status === 'registered' && existing.erpSaleId !== null) {
      throw new SaleAlreadyRegisteredError(existing.erpSaleId);
    }
    throw new SaleUncertainError(`Tentativa ${existing.status} neste ciclo`);
  }

  async finish(cycleId: string, outcome: SaleAttemptOutcome): Promise<void> {
    await this.db
      .update(saleAttempts)
      .set({
        status: outcome.status,
        errorKind: outcome.errorKind ?? null,
        erpSaleId: outcome.erpSaleId ?? null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(saleAttempts.cycleId, cycleId),
          inArray(saleAttempts.status, ['pending', 'uncertain']),
        ),
      );
  }

  async statusOf(cycleId: string): Promise<SaleAttemptStatus | null> {
    const [row] = await this.db
      .select({ status: saleAttempts.status })
      .from(saleAttempts)
      .where(eq(saleAttempts.cycleId, cycleId));
    return row ? (row.status as SaleAttemptStatus) : null;
  }

  sweepStale(): Promise<{ cycleId: string; isSimulated: boolean }[]> {
    return this.db
      .update(saleAttempts)
      .set({ status: 'uncertain', errorKind: 'restart', updatedAt: sql`now()` })
      .where(
        and(
          eq(saleAttempts.status, 'pending'),
          lt(saleAttempts.updatedAt, sql`now() - make_interval(secs => ${STALE_ATTEMPT_SECONDS})`),
        ),
      )
      .returning({ cycleId: saleAttempts.cycleId, isSimulated: saleAttempts.isSimulated });
  }

  private async hasRecentUncertain(attempt: SaleAttemptInput): Promise<boolean> {
    const rows = await this.db
      .select({ id: saleAttempts.id })
      .from(saleAttempts)
      .where(
        and(
          eq(saleAttempts.customerId, attempt.customerId),
          ne(saleAttempts.cycleId, attempt.cycleId),
          eq(saleAttempts.status, 'uncertain'),
          eq(saleAttempts.isSimulated, attempt.isSimulated),
          gt(saleAttempts.updatedAt, sql`now() - make_interval(hours => ${UNCERTAIN_GUARD_HOURS})`),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  private async claim(attempt: SaleAttemptInput): Promise<Existing> {
    const inserted = await this.db
      .insert(saleAttempts)
      .values({ ...attempt, status: 'pending' })
      .onConflictDoNothing({ target: saleAttempts.cycleId })
      .returning({ id: saleAttempts.id });
    if (inserted.length) return undefined;

    const reopened = await this.db
      .update(saleAttempts)
      .set({ ...attempt, status: 'pending', errorKind: null, updatedAt: sql`now()` })
      .where(and(eq(saleAttempts.cycleId, attempt.cycleId), eq(saleAttempts.status, 'failed')))
      .returning({ id: saleAttempts.id });
    if (reopened.length) return undefined;

    const [row] = await this.db
      .select({ status: saleAttempts.status, erpSaleId: saleAttempts.erpSaleId })
      .from(saleAttempts)
      .where(eq(saleAttempts.cycleId, attempt.cycleId));
    return row
      ? { status: row.status as SaleAttemptStatus, erpSaleId: row.erpSaleId }
      : { status: 'pending', erpSaleId: null };
  }

  private async store<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new SaleAttemptStoreError('Falha ao gravar a tentativa de venda', { cause: error });
    }
  }
}
