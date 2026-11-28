import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import { BotEventsRepository } from 'src/modules/metrics/bot-events.repository';
import { HandoffRepository } from './handoff.repository';
import { HandoffService } from './handoff.service';

@Injectable()
export class QueueSnapshotScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly handoff: HandoffService,
    private readonly repo: HandoffRepository,
    private readonly events: BotEventsRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(QueueSnapshotScheduler.name);
  }

  onModuleInit(): void {
    if (env.NODE_ENV === 'test' || !env.METRICS_ENABLED) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), env.METRICS_QUEUE_SNAPSHOT_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (!env.METRICS_ENABLED || this.running) return;
    this.running = true;
    try {
      const lockSeconds = Math.max(1, Math.floor(env.METRICS_QUEUE_SNAPSHOT_SECONDS * 0.9));
      if (!(await this.repo.claimQueueSnapshot(lockSeconds))) return;
      const { size, oldestAgeMs } = await this.handoff.queueStats();
      this.events.record({
        name: 'handoff_queue_snapshot',
        amount: size,
        durationMs: oldestAgeMs ?? undefined,
      });
    } catch {
      this.logger.warn('Falha ao registrar a fotografia da fila de handoff');
    } finally {
      this.running = false;
    }
  }
}
