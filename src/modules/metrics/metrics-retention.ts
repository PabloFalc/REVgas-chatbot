import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import { BotEventsRepository } from './bot-events.repository';

const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MetricsRetention implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly events: BotEventsRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MetricsRetention.name);
  }

  onModuleInit(): void {
    if (env.NODE_ENV === 'test' || !env.METRICS_ENABLED) return;
    void this.prune();
    this.timer = setInterval(() => void this.prune(), RETENTION_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private async prune(): Promise<void> {
    try {
      await this.events.prune();
    } catch {
      this.logger.warn('Falha ao remover métricas vencidas');
    }
  }
}
