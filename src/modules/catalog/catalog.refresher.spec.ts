import type { PinoLogger } from 'nestjs-pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogRefresher, REFRESH_INTERVAL_MS } from './catalog.refresher';
import type { CatalogRepository } from './catalog.repository';

const envMock = vi.hoisted(() => ({ NODE_ENV: 'development' }));
vi.mock('src/config/env', () => ({ env: envMock }));

const build = () => {
  const refresh = vi.fn(async (): Promise<string[]> => []);
  const logger = {
    setContext: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
  const refresher = new CatalogRefresher({ refresh } as unknown as CatalogRepository, logger);
  return { refresher, refresh, logger };
};

describe('CatalogRefresher', () => {
  beforeEach(() => {
    envMock.NODE_ENV = 'development';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes on boot and again on every interval, before the cache expires', async () => {
    const { refresher, refresh } = build();

    refresher.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(REFRESH_INTERVAL_MS).toBeLessThan(600_000);

    refresher.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does nothing in tests', async () => {
    envMock.NODE_ENV = 'test';
    const { refresher, refresh } = build();

    refresher.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('skips a tick while the previous one is still running', async () => {
    const { refresher, refresh } = build();
    let finish: (value: string[]) => void = () => undefined;
    refresh.mockReturnValueOnce(new Promise(resolve => (finish = resolve)));

    const first = refresher.tick();
    await refresher.tick();
    finish([]);
    await first;

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('warns with the failed keys and logs errors without throwing', async () => {
    const { refresher, refresh, logger } = build();
    refresh.mockResolvedValueOnce(['deals']);
    await refresher.tick();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ failed: ['deals'] }),
      'Catálogo atualizado em parte',
    );

    refresh.mockRejectedValueOnce(new Error('boom'));
    await expect(refresher.tick()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
