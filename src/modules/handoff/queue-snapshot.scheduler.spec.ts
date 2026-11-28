import type { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import type { BotEventsRepository } from 'src/modules/metrics/bot-events.repository';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HandoffRepository } from './handoff.repository';
import type { HandoffService } from './handoff.service';
import { QueueSnapshotScheduler } from './queue-snapshot.scheduler';

function setup() {
  const handoff = {
    queueStats: vi.fn(
      async (): Promise<{ size: number; oldestAgeMs: number | null }> => ({
        size: 3,
        oldestAgeMs: 120_000,
      }),
    ),
  };
  const repo = { claimQueueSnapshot: vi.fn(async () => true) };
  const events = { record: vi.fn() };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const scheduler = new QueueSnapshotScheduler(
    handoff as unknown as HandoffService,
    repo as unknown as HandoffRepository,
    events as unknown as BotEventsRepository,
    logger as unknown as PinoLogger,
  );
  return { scheduler, handoff, repo, events, logger };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('QueueSnapshotScheduler', () => {
  it('grava o tamanho da fila e a idade do mais antigo', async () => {
    const { scheduler, events } = setup();
    await scheduler.tick();
    expect(events.record).toHaveBeenCalledExactlyOnceWith({
      name: 'handoff_queue_snapshot',
      amount: 3,
      durationMs: 120_000,
    });
  });

  it('fila vazia grava amount 0 sem idade', async () => {
    const { scheduler, handoff, events } = setup();
    handoff.queueStats.mockResolvedValueOnce({ size: 0, oldestAgeMs: null });
    await scheduler.tick();
    expect(events.record).toHaveBeenCalledExactlyOnceWith({
      name: 'handoff_queue_snapshot',
      amount: 0,
      durationMs: undefined,
    });
  });

  it('não grava quando outra instância já detém o lock', async () => {
    const { scheduler, repo, handoff, events } = setup();
    repo.claimQueueSnapshot.mockResolvedValueOnce(false);
    await scheduler.tick();
    expect(handoff.queueStats).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it('lock dura 90% do intervalo', async () => {
    const { scheduler, repo } = setup();
    await scheduler.tick();
    expect(repo.claimQueueSnapshot).toHaveBeenCalledWith(
      Math.floor(env.METRICS_QUEUE_SNAPSHOT_SECONDS * 0.9),
    );
  });

  it('não faz nada com METRICS_ENABLED desligado', async () => {
    vi.spyOn(env, 'METRICS_ENABLED', 'get').mockReturnValue(false);
    const { scheduler, repo, events } = setup();
    await scheduler.tick();
    expect(repo.claimQueueSnapshot).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it('falha vira apenas aviso fixo e não propaga', async () => {
    const { scheduler, handoff, events, logger } = setup();
    handoff.queueStats.mockRejectedValueOnce(new Error('segredo'));
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(events.record).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Falha ao registrar a fotografia da fila de handoff',
    );
  });

  it('não inicia no ambiente de teste', () => {
    const { scheduler, repo } = setup();
    scheduler.onModuleInit();
    expect(repo.claimQueueSnapshot).not.toHaveBeenCalled();
  });

  it('fotografa ao iniciar, repete no intervalo e para ao destruir', async () => {
    vi.useFakeTimers();
    vi.spyOn(env, 'NODE_ENV', 'get').mockReturnValue('development');
    vi.spyOn(env, 'METRICS_ENABLED', 'get').mockReturnValue(true);
    const { scheduler, events } = setup();
    scheduler.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(events.record).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(env.METRICS_QUEUE_SNAPSHOT_SECONDS * 1000);
    expect(events.record).toHaveBeenCalledTimes(2);
    scheduler.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(env.METRICS_QUEUE_SNAPSHOT_SECONDS * 1000);
    expect(events.record).toHaveBeenCalledTimes(2);
  });
});
