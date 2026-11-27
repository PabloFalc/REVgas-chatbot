import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import { DRIZZLE } from 'src/infra/database/drizzle-client';
import type * as schema from 'src/infra/database/schemas';
import { botEvents } from 'src/infra/database/schemas/metrics/bot-events.table';
import { resolveRevgasConfig } from 'src/integrations/revgas/shared/revgas.config';
import type { MetricEvent } from './contracts/metrics.types';

@Injectable()
export class BotEventsRepository {
  private readonly isSimulated = resolveRevgasConfig(env).mode !== 'live';

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BotEventsRepository.name);
  }

  record(event: MetricEvent): void {
    if (!env.METRICS_ENABLED) return;
    try {
      void this.db
        .insert(botEvents)
        .values({ ...event, isSimulated: this.isSimulated, occurredAt: new Date() })
        .catch(() => this.warn());
    } catch {
      this.warn();
    }
  }

  async prune(): Promise<void> {
    if (!env.METRICS_ENABLED) return;
    await this.db
      .delete(botEvents)
      .where(
        sql`${botEvents.occurredAt} < now() - make_interval(days => ${env.METRICS_RETENTION_DAYS})`,
      );
  }

  private warn(): void {
    this.logger.warn('Falha ao gravar métrica');
  }
}
