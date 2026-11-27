import type { PinoLogger } from 'nestjs-pino';
import type { BotEventsRepository } from 'src/modules/metrics/bot-events.repository';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaleAttemptsRepository } from './sale-attempts.repository';
import { SaleAttemptsSweeper, SWEEP_DELAY_MS } from './sale-attempts.sweeper';

const envMock = vi.hoisted(() => ({ NODE_ENV: 'development' }));
vi.mock('src/config/env', () => ({ env: envMock }));

const build = () => {
  const sweepStale = vi.fn(async (): Promise<{ cycleId: string; isSimulated: boolean }[]> => []);
  const record = vi.fn();
  const logger = {
    setContext: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
  const sweeper = new SaleAttemptsSweeper(
    { sweepStale } as unknown as SaleAttemptsRepository,
    { record } as unknown as BotEventsRepository,
    logger,
  );
  return { sweeper, sweepStale, record, logger };
};

describe('SaleAttemptsSweeper', () => {
  beforeEach(() => {
    envMock.NODE_ENV = 'development';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('varre uma única vez 60 s depois do boot', async () => {
    const { sweeper, sweepStale } = build();

    sweeper.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS - 1);
    expect(sweepStale).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(sweepStale).toHaveBeenCalledTimes(1);
    expect(SWEEP_DELAY_MS).toBe(60_000);

    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS * 10);
    expect(sweepStale).toHaveBeenCalledTimes(1);
  });

  it('não varre quando o módulo é destruído antes do prazo', async () => {
    const { sweeper, sweepStale } = build();

    sweeper.onApplicationBootstrap();
    sweeper.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS);

    expect(sweepStale).not.toHaveBeenCalled();
  });

  it('não agenda a varredura em testes', async () => {
    envMock.NODE_ENV = 'test';
    const { sweeper, sweepStale } = build();

    sweeper.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS);

    expect(sweepStale).not.toHaveBeenCalled();
  });

  it('emite um evento e um aviso por tentativa marcada, sem dado pessoal', async () => {
    const { sweeper, sweepStale, record, logger } = build();
    sweepStale.mockResolvedValueOnce([
      { cycleId: 'ciclo-1', isSimulated: true },
      { cycleId: 'ciclo-2', isSimulated: false },
    ]);

    await sweeper.sweep();

    expect(record.mock.calls).toEqual([
      [{ name: 'sale_outcome_unknown', cycleId: 'ciclo-1', reason: 'other', isSimulated: true }],
      [{ name: 'sale_outcome_unknown', cycleId: 'ciclo-2', reason: 'other', isSimulated: false }],
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      {
        component: 'sale_attempt',
        event: 'sale_attempt_swept',
        cycleId: 'ciclo-1',
        erpSaleId: null,
      },
      expect.any(String),
    );
  });

  it('engole a falha do repositório e loga só o nome do erro', async () => {
    const { sweeper, sweepStale, record, logger } = build();
    sweepStale.mockRejectedValueOnce(new Error('senha do banco no texto do driver'));

    await expect(sweeper.sweep()).resolves.toBeUndefined();

    expect(record).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('senha');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'sale_attempt_sweep_failed', error: 'Error' }),
      expect.any(String),
    );
  });
});
