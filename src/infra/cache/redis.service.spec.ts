import type { Redis } from 'ioredis';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { RedisService } from './redis.service';

function build(del: ReturnType<typeof vi.fn>) {
  const logger = { setContext: vi.fn(), error: vi.fn() };
  const service = new RedisService({ del } as unknown as Redis, logger as unknown as PinoLogger);
  return { service, logger };
}

describe('RedisService.delete', () => {
  it('apaga a chave com prefixo', async () => {
    const del = vi.fn().mockResolvedValue(1);
    const { service } = build(del);
    await service.delete({ prefix: 'p', key: 'k' });
    expect(del).toHaveBeenCalledWith('p:k');
  });

  it('loga o erro do Redis e não propaga', async () => {
    const del = vi.fn().mockRejectedValue(new Error('boom'));
    const { service, logger } = build(del);
    await expect(service.delete({ prefix: 'p', key: 'k' })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('não loga a chave no erro, só o prefixo', async () => {
    const del = vi.fn().mockRejectedValue(new Error('boom'));
    const { service, logger } = build(del);
    await service.delete({ prefix: 'p', key: '5586999990000' });
    const [fields] = logger.error.mock.calls[0];
    expect(fields).toMatchObject({ component: 'cache', prefix: 'p' });
    expect(JSON.stringify(fields)).not.toContain('5586999990000');
    expect(fields).not.toHaveProperty('key');
  });

  it('withPrefix expõe delete', async () => {
    const del = vi.fn().mockResolvedValue(1);
    const { service } = build(del);
    await service.withPrefix('p').delete({ prefix: 'p', key: 'k' });
    expect(del).toHaveBeenCalledWith('p:k');
  });
});

describe('RedisService.deleteIfEquals', () => {
  function buildEval(evalFn: ReturnType<typeof vi.fn>) {
    const logger = { setContext: vi.fn(), error: vi.fn() };
    const service = new RedisService(
      { eval: evalFn } as unknown as Redis,
      logger as unknown as PinoLogger,
    );
    return { service, logger };
  }

  it('executa o script Lua com a chave com prefixo e o valor serializado', async () => {
    const evalFn = vi.fn().mockResolvedValue(1);
    const { service } = buildEval(evalFn);

    await expect(service.deleteIfEquals({ prefix: 'p', key: 'k', value: 'tok' })).resolves.toBe(
      true,
    );

    expect(evalFn).toHaveBeenCalledWith(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      'p:k',
      '"tok"',
    );
  });

  it('devolve false quando o valor não confere', async () => {
    const { service } = buildEval(vi.fn().mockResolvedValue(0));
    await expect(service.deleteIfEquals({ prefix: 'p', key: 'k', value: 'x' })).resolves.toBe(
      false,
    );
  });

  it('loga o erro do Redis e devolve false', async () => {
    const { service, logger } = buildEval(vi.fn().mockRejectedValue(new Error('boom')));
    await expect(service.deleteIfEquals({ prefix: 'p', key: 'k', value: 'x' })).resolves.toBe(
      false,
    );
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('RedisService primitivas novas', () => {
  function buildWith(redis: Record<string, unknown>) {
    const logger = { setContext: vi.fn(), error: vi.fn() };
    return new RedisService(redis as unknown as Redis, logger as unknown as PinoLogger);
  }

  it('setKeepTtl grava com KEEPTTL e XX', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    await buildWith({ set }).setKeepTtl({ prefix: 'p', key: 'k', value: { a: 1 } });
    expect(set).toHaveBeenCalledWith('p:k', '{"a":1}', 'KEEPTTL', 'XX');
  });

  it('increment define TTL só na primeira vez', async () => {
    const incr = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const expire = vi.fn().mockResolvedValue(1);
    const service = buildWith({ incr, expire });

    await expect(service.increment({ prefix: 'p', key: 'k', ttl: 3600 })).resolves.toBe(1);
    expect(expire).toHaveBeenCalledWith('p:k', 3600);

    expire.mockClear();
    await expect(service.increment({ prefix: 'p', key: 'k', ttl: 3600 })).resolves.toBe(2);
    expect(expire).not.toHaveBeenCalled();
  });

  it('scheduleAdd chama zadd', async () => {
    const zadd = vi.fn().mockResolvedValue(1);
    await buildWith({ zadd }).scheduleAdd({ set: 's', member: 'm', at: 1000 });
    expect(zadd).toHaveBeenCalledWith('s', 1000, 'm');
  });

  it('scheduleRemove chama zrem', async () => {
    const zrem = vi.fn().mockResolvedValue(1);
    await buildWith({ zrem }).scheduleRemove({ set: 's', member: 'm' });
    expect(zrem).toHaveBeenCalledWith('s', 'm');
  });

  it('scheduleDue converte WITHSCORES em pares', async () => {
    const zrangebyscore = vi.fn().mockResolvedValue(['5586', '1000', '5587', '2000']);
    const result = await buildWith({ zrangebyscore }).scheduleDue({
      set: 's',
      upTo: 5000,
      limit: 50,
    });
    expect(result).toEqual([
      { member: '5586', at: 1000 },
      { member: '5587', at: 2000 },
    ]);
    expect(zrangebyscore).toHaveBeenCalledWith('s', '-inf', 5000, 'WITHSCORES', 'LIMIT', 0, 50);
  });

  it('scheduleClaim devolve true só quando o eval remove', async () => {
    const evalFn = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const service = buildWith({ eval: evalFn });
    await expect(service.scheduleClaim({ set: 's', member: 'm', at: 1000 })).resolves.toBe(true);
    expect(evalFn).toHaveBeenCalledWith(expect.stringContaining('zscore'), 1, 's', 'm', '1000');
    await expect(service.scheduleClaim({ set: 's', member: 'm', at: 1000 })).resolves.toBe(false);
  });
});
