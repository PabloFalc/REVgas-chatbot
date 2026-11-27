import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import { BotEventsRepository } from 'src/modules/metrics/bot-events.repository';
import { SaleAttemptsRepository, STALE_ATTEMPT_SECONDS } from './sale-attempts.repository';

export const SWEEP_DELAY_MS = STALE_ATTEMPT_SECONDS * 1000;

@Injectable()
export class SaleAttemptsSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly attempts: SaleAttemptsRepository,
    private readonly events: BotEventsRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SaleAttemptsSweeper.name);
  }

  onApplicationBootstrap(): void {
    if (env.NODE_ENV === 'test') return;
    this.timer = setTimeout(() => void this.sweep(), SWEEP_DELAY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  async sweep(): Promise<void> {
    try {
      const rows = await this.attempts.sweepStale();
      for (const { cycleId, isSimulated } of rows) {
        this.events.record({ name: 'sale_outcome_unknown', cycleId, reason: 'other', isSimulated });
        this.logger.warn(
          { component: 'sale_attempt', event: 'sale_attempt_swept', cycleId, erpSaleId: null },
          'Tentativa pendente marcada como incerta após reinício',
        );
      }
    } catch (error) {
      this.logger.error(
        {
          component: 'sale_attempt',
          event: 'sale_attempt_sweep_failed',
          error: error instanceof Error ? error.name : typeof error,
        },
        'Falha ao varrer tentativas pendentes',
      );
    }
  }
}
