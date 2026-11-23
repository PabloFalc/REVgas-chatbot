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

afterEach(() => vi.restoreAllMocks());

describe('BotEventsRepository', () => {
  it('grava um evento com horário da aplicação', async () => {
    const { repository, values } = setup();
    expect(repository.record({ name: 'turn', durationMs: 12 })).toBeUndefined();
    expect(values).toHaveBeenCalledWith({
      name: 'turn',
      durationMs: 12,
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
