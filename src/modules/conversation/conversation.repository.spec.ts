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
    deleteIfEquals: vi.fn(async (params: { prefix?: string; key: string; value: unknown }) => {
      if (store.get(idOf(params)) !== params.value) return false;
      store.delete(idOf(params));
      return true;
    }),
  };
  const logger = { setContext: vi.fn(), error: vi.fn(), warn: vi.fn() };
  const repository = new ConversationRepository(
    cache as unknown as RedisService,
    logger as unknown as PinoLogger,
  );
  return { repository, cache, logger, store };
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

  it('withPhoneLock grava um token com TTL de 120 s e libera só o próprio token', async () => {
    const { repository, cache, store } = setupStore();

    await expect(
      repository.withPhoneLock('55', async () => {
        throw new Error('falhou');
      }),
    ).rejects.toThrow('falhou');

    const [call] = cache.setIfAbsent.mock.calls[0];
    expect(call).toMatchObject({ prefix: LOCK_PREFIX, key: '55', ttl: 120 });
    expect(typeof call.value).toBe('string');
    expect(cache.deleteIfEquals).toHaveBeenCalledWith({
      prefix: LOCK_PREFIX,
      key: '55',
      value: call.value,
    });
    expect(store.has(`${LOCK_PREFIX}:55`)).toBe(false);
  });

  it('quem desistiu de esperar segue sem apagar o lock do outro dono', async () => {
    vi.useFakeTimers();
    try {
      const { repository, cache, logger, store } = setupStore();
      await cache.setIfAbsent({ prefix: LOCK_PREFIX, key: '5586999991234', value: 'dono' });

      const pending = repository.withPhoneLock('5586999991234', async () => 'ok');
      await vi.advanceTimersByTimeAsync(121_000);

      await expect(pending).resolves.toBe('ok');
      expect(store.get(`${LOCK_PREFIX}:5586999991234`)).toBe('dono');
      expect(cache.deleteIfEquals).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn.mock.calls[0][0]).toEqual({
        component: 'conversation',
        from: '*******1234',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
