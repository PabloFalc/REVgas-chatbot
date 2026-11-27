import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import type * as schema from 'src/infra/database/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotEventsRepository } from './bot-events.repository';

function setup() {
  const values = vi.fn(() => Promise.resolve());
  const where = vi.fn(() => Promise.resolve());
  const db = { insert: vi.fn(() => ({ values })), delete: vi.fn(() => ({ where })) };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const repository = new BotEventsRepository(
    db as unknown as NodePgDatabase<typeof schema>,
    logger as unknown as PinoLogger,
  );
  return { repository, db, values, where, logger };
}

const revgasEnv = {
  REVGAS_MODE: env.REVGAS_MODE,
  REVGAS_API_KEY: env.REVGAS_API_KEY,
  REVGAS_ESTABLISHMENT_ID: env.REVGAS_ESTABLISHMENT_ID,
};

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(env, revgasEnv);
});

describe('BotEventsRepository', () => {
  it('grava um evento com horário da aplicação', async () => {
    const { repository, values } = setup();
    expect(repository.record({ name: 'turn', durationMs: 12 })).toBeUndefined();
    expect(values).toHaveBeenCalledWith({
      name: 'turn',
      durationMs: 12,
      isSimulated: true,
      occurredAt: expect.any(Date),
    });
  });

  it('grava o modo efetivo da venda em cada evento', () => {
    const cases = [
      { mode: 'fake', isSimulated: true },
      { mode: 'hybrid', isSimulated: true },
      { mode: 'live', isSimulated: false },
    ] as const;
    for (const { mode, isSimulated } of cases) {
      Object.assign(env, {
        REVGAS_MODE: mode,
        REVGAS_API_KEY: 'chave-de-teste',
        REVGAS_ESTABLISHMENT_ID: 1,
      });
      const { repository, values } = setup();
      repository.record({ name: 'order_cancelled' });
      expect(values).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ isSimulated }));
    }
  });

  it('grava o segmento de purchase_started na coluna reason sem dado pessoal', () => {
    const { repository, values } = setup();
    const cycleId = '6f1c1b0e-2d3c-4f4a-8a55-0d2f7a9b1c11';
    repository.record({ name: 'purchase_started', cycleId, reason: 'recurring' });
    expect(values).toHaveBeenCalledExactlyOnceWith({
      name: 'purchase_started',
      cycleId,
      reason: 'recurring',
      isSimulated: true,
      occurredAt: expect.any(Date),
    });
  });

  it('isola rejeição do insert sem registrar dados', async () => {
    const { repository, values, logger } = setup();
    values.mockRejectedValueOnce(new Error('dado privado'));
    expect(repository.record({ name: 'turn', durationMs: 12 })).toBeUndefined();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('Falha ao gravar métrica');
  });

  it('isola exceção síncrona do insert', () => {
    const { repository, db, logger } = setup();
    db.insert.mockImplementationOnce(() => {
      throw new Error('dado privado');
    });
    expect(() => repository.record({ name: 'turn', durationMs: 12 })).not.toThrow();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('Falha ao gravar métrica');
  });

  it('não grava nem remove eventos quando desabilitado', async () => {
    vi.spyOn(env, 'METRICS_ENABLED', 'get').mockReturnValue(false);
    const { repository, db } = setup();
    repository.record({ name: 'turn', durationMs: 12 });
    await repository.prune();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('remove eventos pela data de retenção', async () => {
    const { repository, db, where } = setup();
    await repository.prune();
    expect(db.delete).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();
  });
});
