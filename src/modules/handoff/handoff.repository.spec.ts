import type { RedisService } from 'src/infra/cache/redis.service';
import { describe, expect, it, vi } from 'vitest';
import {
  CONTACT_PREFIX,
  DESK_EVENT_PREFIX,
  HANDOFF_PREFIX,
  HandoffRepository,
  THREAD_PREFIX,
} from './handoff.repository';

function setup(setIfAbsent: () => Promise<boolean> = async () => true) {
  const cache = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    setIfAbsent: vi.fn(setIfAbsent),
  };
  return { repository: new HandoffRepository(cache as unknown as RedisService), cache };
}

describe('HandoffRepository', () => {
  it('guarda o estado com prefixo e TTL de 7 dias', async () => {
    const { repository, cache } = setup();
    const state = {
      status: 'queued' as const,
      conversationId: 5,
      reason: 'customer_request' as const,
      since: '2026-01-01T00:00:00.000Z',
    };
    await repository.saveState('5585', state);
    expect(cache.set).toHaveBeenCalledWith({
      prefix: HANDOFF_PREFIX,
      key: '5585',
      value: state,
      ttl: 604_800,
    });
    await repository.getState('5585');
    expect(cache.get).toHaveBeenCalledWith({ prefix: HANDOFF_PREFIX, key: '5585' });
    await repository.clearState('5585');
    expect(cache.delete).toHaveBeenCalledWith({ prefix: HANDOFF_PREFIX, key: '5585' });
  });

  it('guarda a conversa com TTL de 7 dias', async () => {
    const { repository, cache } = setup();
    await repository.saveThread('5585', { conversationId: 9 });
    expect(cache.set).toHaveBeenCalledWith({
      prefix: THREAD_PREFIX,
      key: '5585',
      value: { conversationId: 9 },
      ttl: 604_800,
    });
    await repository.getThread('5585');
    expect(cache.get).toHaveBeenCalledWith({ prefix: THREAD_PREFIX, key: '5585' });
    await repository.clearThread('5585');
    expect(cache.delete).toHaveBeenCalledWith({ prefix: THREAD_PREFIX, key: '5585' });
  });

  it('guarda o contato com TTL de 30 dias', async () => {
    const { repository, cache } = setup();
    await repository.saveContact('5585', { contactId: 1, sourceId: 'x' });
    expect(cache.set).toHaveBeenCalledWith({
      prefix: CONTACT_PREFIX,
      key: '5585',
      value: { contactId: 1, sourceId: 'x' },
      ttl: 2_592_000,
    });
    await repository.getContact('5585');
    expect(cache.get).toHaveBeenCalledWith({ prefix: CONTACT_PREFIX, key: '5585' });
  });

  it('claimDeskMessage: true na primeira, false na segunda', async () => {
    const seen = new Set<string>();
    const cache = {
      setIfAbsent: vi.fn(async ({ key }: { key: string }) => {
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    };
    const repository = new HandoffRepository(cache as unknown as RedisService);
    await expect(repository.claimDeskMessage(42)).resolves.toBe(true);
    await expect(repository.claimDeskMessage(42)).resolves.toBe(false);
    expect(cache.setIfAbsent).toHaveBeenCalledWith({
      prefix: DESK_EVENT_PREFIX,
      key: '42',
      value: 1,
      ttl: 86_400,
    });
  });

  it('claimDeskMessage: erro do Redis devolve true', async () => {
    const { repository } = setup(async () => {
      throw new Error('redis fora');
    });
    await expect(repository.claimDeskMessage(1)).resolves.toBe(true);
  });
});
