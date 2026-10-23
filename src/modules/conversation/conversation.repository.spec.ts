import type { PinoLogger } from 'nestjs-pino';
import type { RedisService } from 'src/infra/cache/redis.service';
import { describe, expect, it, vi } from 'vitest';
import {
  BLOCKED_PREFIX,
  ConversationRepository,
  CPF_ATTEMPTS_PREFIX,
  INBOUND_PREFIX,
  LOCK_PREFIX,
  ORDER_PREFIX,
  REMINDER_SET,
  VERIFIED_PREFIX,
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

function setupIdentity() {
  const store = new Map<string, unknown>();
  const counters = new Map<string, number>();
  const idOf = ({ prefix, key }: { prefix?: string; key: string }) => `${prefix}:${key}`;
  const cache = {
    set: vi.fn(async (params: { prefix?: string; key: string; value: unknown }) => {
      store.set(idOf(params), params.value);
    }),
    setKeepTtl: vi.fn(async () => undefined),
    exists: vi.fn(async (params: { prefix?: string; key: string }) => store.has(idOf(params))),
    delete: vi.fn(async (params: { prefix?: string; key: string }) => {
      store.delete(idOf(params));
    }),
    increment: vi.fn(async (params: { prefix?: string; key: string }) => {
      const next = (counters.get(idOf(params)) ?? 0) + 1;
      counters.set(idOf(params), next);
      return next;
    }),
    scheduleAdd: vi.fn(async () => undefined),
    scheduleRemove: vi.fn(async () => undefined),
    scheduleDue: vi.fn(async () => [{ member: '5586999991234', at: 5 }]),
    scheduleClaim: vi.fn(async () => true),
    setIfAbsent: vi.fn(async (params: { prefix?: string; key: string; value: unknown }) => {
      if (store.has(idOf(params))) return false;
      store.set(idOf(params), params.value);
      return true;
    }),
    deleteIfEquals: vi.fn(async () => true),
  };
  const logger = { setContext: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const repository = new ConversationRepository(
    cache as unknown as RedisService,
    logger as unknown as PinoLogger,
  );
  return { repository, cache, logger, store };
}

describe('ConversationRepository (identidade)', () => {
  const phone = '5586999991234';

  it('isVerified depende do par telefone+cliente', async () => {
    const { repository, cache } = setupIdentity();
    await repository.markVerified(phone, 1);

    await expect(repository.isVerified(phone, 1)).resolves.toBe(true);
    await expect(repository.isVerified(phone, 2)).resolves.toBe(false);
    expect(cache.set).toHaveBeenCalledWith({
      prefix: VERIFIED_PREFIX,
      key: `${phone}:1`,
      value: 1,
      ttl: 1_296_000,
    });
  });

  it('terceiro erro bloqueia por 1 hora', async () => {
    const { repository, cache } = setupIdentity();

    await expect(repository.registerCpfMismatch(phone)).resolves.toBe(1);
    await expect(repository.registerCpfMismatch(phone)).resolves.toBe(2);
    expect(cache.set).not.toHaveBeenCalled();
    await expect(repository.isBlocked(phone)).resolves.toBe(false);

    await expect(repository.registerCpfMismatch(phone)).resolves.toBe(3);
    expect(cache.set).toHaveBeenCalledWith({
      prefix: BLOCKED_PREFIX,
      key: phone,
      value: 1,
      ttl: 3_600,
    });
    expect(cache.increment).toHaveBeenCalledWith({
      prefix: CPF_ATTEMPTS_PREFIX,
      key: phone,
      ttl: 3_600,
    });
    await expect(repository.isBlocked(phone)).resolves.toBe(true);
  });

  it('markVerified apaga as tentativas', async () => {
    const { repository, cache } = setupIdentity();
    await repository.markVerified(phone, 1);
    expect(cache.delete).toHaveBeenCalledWith({ prefix: CPF_ATTEMPTS_PREFIX, key: phone });
  });

  it('logs de identidade não contêm o telefone cru', async () => {
    const { repository, logger } = setupIdentity();
    await repository.markVerified(phone, 1);
    for (let i = 0; i < 3; i++) await repository.registerCpfMismatch(phone);

    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledTimes(4);
    expect(JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls])).not.toContain(phone);
  });
});

describe('ConversationRepository (estado e agenda)', () => {
  const phone = '5586999991234';

  it('saveOrderKeepingTtl usa setKeepTtl e nunca set', async () => {
    const { repository, cache } = setupIdentity();
    const state = { step: 'askName' as const, customer: {} };
    await repository.saveOrderKeepingTtl(phone, state);
    expect(cache.setKeepTtl).toHaveBeenCalledWith({
      prefix: ORDER_PREFIX,
      key: phone,
      value: state,
    });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('scheduleReminder grava at em ms; cancel, due e claim delegam', async () => {
    const { repository, cache } = setupIdentity();
    const date = new Date(1_000_000);
    await repository.scheduleReminder(phone, date);
    expect(cache.scheduleAdd).toHaveBeenCalledWith({
      set: REMINDER_SET,
      member: phone,
      at: 1_000_000,
    });

    await repository.cancelReminder(phone);
    expect(cache.scheduleRemove).toHaveBeenCalledWith({ set: REMINDER_SET, member: phone });

    await expect(repository.dueReminders(date)).resolves.toEqual([{ phone, at: 5 }]);
    expect(cache.scheduleDue).toHaveBeenCalledWith({
      set: REMINDER_SET,
      upTo: 1_000_000,
      limit: 50,
    });

    await expect(repository.claimReminder(phone, 5)).resolves.toBe(true);
    expect(cache.scheduleClaim).toHaveBeenCalledWith({ set: REMINDER_SET, member: phone, at: 5 });
  });

  it('tryPhoneLock com lock ocupado não roda o trabalho', async () => {
    const { repository, cache } = setupIdentity();
    cache.setIfAbsent.mockResolvedValueOnce(false);
    const work = vi.fn(async () => 'x');

    await expect(repository.tryPhoneLock(phone, work)).resolves.toEqual({ ran: false });
    expect(work).not.toHaveBeenCalled();
    expect(cache.deleteIfEquals).not.toHaveBeenCalled();
  });

  it('tryPhoneLock com lock livre roda e libera', async () => {
    const { repository, cache } = setupIdentity();
    const work = vi.fn(async () => 'x');

    await expect(repository.tryPhoneLock(phone, work)).resolves.toEqual({
      ran: true,
      value: 'x',
    });
    expect(cache.setIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: LOCK_PREFIX, key: phone, ttl: 120 }),
    );
    expect(cache.deleteIfEquals).toHaveBeenCalledOnce();
  });
});
