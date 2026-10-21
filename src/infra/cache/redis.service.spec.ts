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
