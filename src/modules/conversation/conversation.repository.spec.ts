import type { PinoLogger } from 'nestjs-pino';
import type { RedisService } from 'src/infra/cache/redis.service';
import { describe, expect, it, vi } from 'vitest';
import {
  ConversationRepository,
  INBOUND_PREFIX,
  LOCK_PREFIX,
  ORDER_PREFIX,
} from './conversation.repository';

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

function setupStore() {
  const store = new Map<string, unknown>();
  const idOf = ({ prefix, key }: { prefix?: string; key: string }) => `${prefix}:${key}`;
  const cache = {
    get: vi.fn(async (params: { prefix?: string; key: string }) => store.get(idOf(params)) ?? null),
    set: vi.fn(async (params: { prefix?: string; key: string; value: unknown }) => {
      store.set(idOf(params), params.value);
    }),
    delete: vi.fn(async (params: { prefix?: string; key: string }) => {
      store.delete(idOf(params));
    }),
    setIfAbsent: vi.fn(async (params: { prefix?: string; key: string; value: unknown }) => {
      if (store.has(idOf(params))) return false;
      store.set(idOf(params), params.value);
      return true;
    }),
  };
  const logger = { setContext: vi.fn(), error: vi.fn(), warn: vi.fn() };
  const repository = new ConversationRepository(
    cache as unknown as RedisService,
    logger as unknown as PinoLogger,
  );
  return { repository, cache, logger };
}

describe('ConversationRepository (pedido em andamento)', () => {
  it('saveOrder grava com prefixo e TTL de 900 s; loadOrder e clearOrder usam o mesmo prefixo', async () => {
    const { repository, cache } = setupStore();
    const state = { step: 'askName' as const, customer: {} };

    await repository.saveOrder('5586999991234', state);
    expect(cache.set).toHaveBeenCalledWith({
      prefix: ORDER_PREFIX,
      key: '5586999991234',
      value: state,
      ttl: 900,
    });
    await expect(repository.loadOrder('5586999991234')).resolves.toEqual(state);

    await repository.clearOrder('5586999991234');
    await expect(repository.loadOrder('5586999991234')).resolves.toBeNull();
  });

  it('withPhoneLock serializa duas chamadas simultâneas do mesmo telefone', async () => {
    const { repository } = setupStore();
    const events: string[] = [];
    const work = (name: string) => async () => {
      events.push(`${name}:start`);
      await new Promise(resolve => setTimeout(resolve, 50));
      events.push(`${name}:end`);
    };

    await Promise.all([
      repository.withPhoneLock('55', work('a')),
      repository.withPhoneLock('55', work('b')),
    ]);

    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('withPhoneLock usa TTL de 30 s e libera mesmo quando o trabalho falha', async () => {
    const { repository, cache } = setupStore();

    await expect(
      repository.withPhoneLock('55', async () => {
        throw new Error('falhou');
      }),
    ).rejects.toThrow('falhou');

    expect(cache.setIfAbsent).toHaveBeenCalledWith({
      prefix: LOCK_PREFIX,
      key: '55',
      value: 1,
      ttl: 30,
    });
    expect(cache.delete).toHaveBeenCalledWith({ prefix: LOCK_PREFIX, key: '55' });
  });

  it('depois de 30 s esperando, segue sem o lock e avisa no log', async () => {
    vi.useFakeTimers();
    try {
      const { repository, cache, logger } = setupStore();
      await cache.setIfAbsent({ prefix: LOCK_PREFIX, key: '55', value: 1 });

      const pending = repository.withPhoneLock('55', async () => 'ok');
      await vi.advanceTimersByTimeAsync(31_000);

      await expect(pending).resolves.toBe('ok');
      expect(logger.warn).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
