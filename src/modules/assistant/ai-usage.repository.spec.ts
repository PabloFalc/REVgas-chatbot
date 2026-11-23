import type { PinoLogger } from 'nestjs-pino';
import type { RedisService } from 'src/infra/cache/redis.service';
import { describe, expect, it, vi } from 'vitest';
import { AiUsageRepository } from './ai-usage.repository';

const envMock = vi.hoisted(() => ({ AI_CALLS_PER_PHONE_HOUR: 30 }));
vi.mock('src/config/env', () => ({ env: envMock }));

function setup(fail: false | Error = false) {
  const counters = new Map<string, number>();
  const cache = {
    increment: vi.fn(async ({ prefix, key }: { prefix: string; key: string }) => {
      if (fail) throw fail;
      const next = (counters.get(`${prefix}:${key}`) ?? 0) + 1;
      counters.set(`${prefix}:${key}`, next);
      return next;
    }),
  };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const repository = new AiUsageRepository(
    cache as unknown as RedisService,
    logger as unknown as PinoLogger,
  );
  return { repository, cache, logger };
}

describe('AiUsageRepository', () => {
  const phone = '5586999991234';

  it('conta com TTL de 1 hora e a 31ª chamada devolve false', async () => {
    const { repository, cache } = setup();
    for (let i = 0; i < 30; i++) await expect(repository.consume(phone, 1)).resolves.toBe(true);
    await expect(repository.consume(phone, 1)).resolves.toBe(false);
    expect(cache.increment).toHaveBeenCalledWith({
      prefix: 'assistant:ai-usage',
      key: phone,
      ttl: 3_600,
    });
  });

  it('custo 2 consome duas unidades', async () => {
    const { repository, cache } = setup();
    await repository.consume(phone, 2);
    expect(cache.increment).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 14; i++) await repository.consume(phone, 2);
    await expect(repository.consume(phone, 2)).resolves.toBe(false);
  });

  it('Redis fora bloqueia a chamada de IA e registra aviso sem telefone', async () => {
    const { repository, logger } = setup(new Error('redis down'));
    await expect(repository.consume(phone, 1)).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(phone);
  });

  it('erro do Redis com a chave nos argumentos não leva o telefone cru ao log', async () => {
    const error = Object.assign(new Error(`ERR on assistant:ai-usage:${phone}`), {
      command: { name: 'incr', args: [`assistant:ai-usage:${phone}`] },
    });
    const { repository, logger } = setup(error);
    await expect(repository.consume(phone, 1)).resolves.toBe(false);
    const [logged] = logger.warn.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(logged).toEqual({ component: 'assistant', error: 'Error' });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(phone);
  });
});
