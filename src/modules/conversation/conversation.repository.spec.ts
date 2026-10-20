import type { PinoLogger } from 'nestjs-pino';
import type { RedisService } from 'src/infra/cache/redis.service';
import { describe, expect, it, vi } from 'vitest';
import { ConversationRepository, INBOUND_PREFIX } from './conversation.repository';

function setup(setIfAbsent: RedisService['setIfAbsent']) {
  const cache = { setIfAbsent: vi.fn(setIfAbsent) };
  const logger = { setContext: vi.fn(), error: vi.fn() };
  const repository = new ConversationRepository(
    cache as unknown as RedisService,
    logger as unknown as PinoLogger,
  );
  return { repository, cache, logger };
}

describe('ConversationRepository.claimMessage', () => {
  it('grava o id da mensagem com prefixo e TTL de 24h', async () => {
    const { repository, cache } = setup(async () => true);

    await expect(repository.claimMessage('wamid.1')).resolves.toBe(true);
    expect(cache.setIfAbsent).toHaveBeenCalledWith({
      prefix: INBOUND_PREFIX,
      key: 'wamid.1',
      value: 1,
      ttl: 86_400,
    });
  });

  it('devolve false quando o id já existe', async () => {
    const { repository } = setup(async () => false);
    await expect(repository.claimMessage('wamid.1')).resolves.toBe(false);
  });

  it('com o Redis fora, loga e processa mesmo assim', async () => {
    const { repository, logger } = setup(async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(repository.claimMessage('wamid.1')).resolves.toBe(true);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
