import type { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotEventsRepository } from './bot-events.repository';
import { MetricsRetention } from './metrics-retention';

function setup() {
  const events = { prune: vi.fn(async () => undefined) };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const retention = new MetricsRetention(
    events as unknown as BotEventsRepository,
    logger as unknown as PinoLogger,
  );
  return { retention, events, logger };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('MetricsRetention', () => {
  it('não inicia no ambiente de teste', () => {
    const { retention, events } = setup();
    retention.onModuleInit();
    expect(events.prune).not.toHaveBeenCalled();
  });

  it('remove ao iniciar, repete em 24h e encerra o timer', async () => {
    vi.useFakeTimers();
    vi.spyOn(env, 'NODE_ENV', 'get').mockReturnValue('development');
    const { retention, events } = setup();
    retention.onModuleInit();
    expect(events.prune).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(events.prune).toHaveBeenCalledTimes(2);
    retention.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(events.prune).toHaveBeenCalledTimes(2);
  });

  it('falha de retenção gera somente aviso', async () => {
    vi.spyOn(env, 'NODE_ENV', 'get').mockReturnValue('development');
    const { retention, events, logger } = setup();
    events.prune.mockRejectedValueOnce(new Error('segredo'));
    retention.onModuleInit();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('Falha ao remover métricas vencidas');
    retention.onModuleDestroy();
  });
});
