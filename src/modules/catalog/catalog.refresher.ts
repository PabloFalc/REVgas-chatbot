import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import { CACHE_TTL_SECONDS, CatalogRepository } from './catalog.repository';

export const REFRESH_INTERVAL_MS = (CACHE_TTL_SECONDS * 1000) / 2;

@Injectable()
export class CatalogRefresher implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly catalog: CatalogRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CatalogRefresher.name);
  }

  onApplicationBootstrap(): void {
    if (env.NODE_ENV === 'test') return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), REFRESH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = Date.now();
    try {
      const failed = await this.catalog.refresh();
      const log = { component: 'catalog', durationMs: Date.now() - startedAt };
      if (failed.length > 0) {
        this.logger.warn({ ...log, failed }, 'Catálogo atualizado em parte');
      } else {
        this.logger.info(log, 'Catálogo atualizado');
      }
    } catch (error) {
      this.logger.error(
        { component: 'catalog', error: error instanceof Error ? error.name : typeof error },
        'Falha ao atualizar o catálogo',
      );
    } finally {
      this.running = false;
    }
  }
}
