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
