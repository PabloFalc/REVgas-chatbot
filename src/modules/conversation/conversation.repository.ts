import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { RedisService } from 'src/infra/cache/redis.service';
import type { OrderState } from './flow/flow.types';

export const INBOUND_PREFIX = 'whatsapp:inbound';
export const ORDER_PREFIX = 'conversation:order';
export const LOCK_PREFIX = 'conversation:lock';
const INBOUND_TTL_SECONDS = 24 * 60 * 60;
const ORDER_TTL_SECONDS = 900;
const LOCK_TTL_SECONDS = 30;
const LOCK_RETRY_MS = 250;
const LOCK_MAX_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

@Injectable()
export class ConversationRepository {
  constructor(
    private readonly cache: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConversationRepository.name);
  }

  async claimMessage(messageId: string): Promise<boolean> {
    try {
      return await this.cache.setIfAbsent({
        prefix: INBOUND_PREFIX,
        key: messageId,
        value: 1,
        ttl: INBOUND_TTL_SECONDS,
      });
    } catch (error) {
      this.logger.error(
        { component: 'conversation', err: error },
        'Falha ao registrar mensagem recebida; processando sem deduplicação',
      );
      return true;
    }
  }

  loadOrder(phone: string): Promise<OrderState | null> {
    return this.cache.get<OrderState>({ prefix: ORDER_PREFIX, key: phone });
  }

  async saveOrder(phone: string, state: OrderState): Promise<void> {
    await this.cache.set({
      prefix: ORDER_PREFIX,
      key: phone,
      value: state,
      ttl: ORDER_TTL_SECONDS,
    });
  }

  async clearOrder(phone: string): Promise<void> {
    await this.cache.delete({ prefix: ORDER_PREFIX, key: phone });
  }

  async withPhoneLock<T>(phone: string, work: () => Promise<T>): Promise<T> {
    await this.acquireLock(phone);
    try {
      return await work();
    } finally {
      await this.cache.delete({ prefix: LOCK_PREFIX, key: phone });
    }
  }

  private async acquireLock(phone: string): Promise<void> {
    const deadline = Date.now() + LOCK_MAX_WAIT_MS;
    while (true) {
      const acquired = await this.cache.setIfAbsent({
        prefix: LOCK_PREFIX,
        key: phone,
        value: 1,
        ttl: LOCK_TTL_SECONDS,
      });
      if (acquired) return;
      if (Date.now() >= deadline) {
        this.logger.warn(
          { component: 'conversation' },
          'Lock do telefone não liberou a tempo; seguindo sem ele',
        );
        return;
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}
