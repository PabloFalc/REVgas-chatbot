import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { RedisService } from 'src/infra/cache/redis.service';
import { maskPhone } from 'src/utils/mask';
import { MAX_CPF_ATTEMPTS, type OrderState } from './flow/flow.types';

export const INBOUND_PREFIX = 'whatsapp:inbound';
export const ORDER_PREFIX = 'conversation:order';
export const LOCK_PREFIX = 'conversation:lock';
export const VERIFIED_PREFIX = 'conversation:verified';
export const CPF_ATTEMPTS_PREFIX = 'conversation:cpf-attempts';
export const BLOCKED_PREFIX = 'conversation:cpf-blocked';
export const REMINDER_SET = 'conversation:reminders';
export { MAX_CPF_ATTEMPTS };

const VERIFIED_TTL_SECONDS = 1_296_000;
const CPF_WINDOW_SECONDS = 3_600;
const BLOCK_TTL_SECONDS = 3_600;
const INBOUND_TTL_SECONDS = 24 * 60 * 60;
const ORDER_TTL_SECONDS = 900;
const LOCK_TTL_SECONDS = 120;
const LOCK_RETRY_MS = 250;
const LOCK_MAX_WAIT_MS = 120_000;

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

  async saveOrderKeepingTtl(phone: string, state: OrderState): Promise<void> {
    await this.cache.setKeepTtl({ prefix: ORDER_PREFIX, key: phone, value: state });
  }

  isVerified(phone: string, customerId: number): Promise<boolean> {
    return this.cache.exists({ prefix: VERIFIED_PREFIX, key: `${phone}:${customerId}` });
  }

  async markVerified(phone: string, customerId: number): Promise<void> {
    await this.cache.set({
      prefix: VERIFIED_PREFIX,
      key: `${phone}:${customerId}`,
      value: 1,
      ttl: VERIFIED_TTL_SECONDS,
    });
    await this.cache.delete({ prefix: CPF_ATTEMPTS_PREFIX, key: phone });
    this.logger.info(
      { component: 'conversation', from: maskPhone(phone) },
      'Identidade confirmada',
    );
  }

  async registerCpfMismatch(phone: string): Promise<number> {
    const attempts = await this.cache.increment({
      prefix: CPF_ATTEMPTS_PREFIX,
      key: phone,
      ttl: CPF_WINDOW_SECONDS,
    });
    this.logger.warn(
      { component: 'conversation', from: maskPhone(phone), attempts },
      'CPF não confere',
    );
    if (attempts >= MAX_CPF_ATTEMPTS) {
      await this.cache.set({
        prefix: BLOCKED_PREFIX,
        key: phone,
        value: 1,
        ttl: BLOCK_TTL_SECONDS,
      });
      this.logger.warn(
        { component: 'conversation', from: maskPhone(phone) },
        'Telefone bloqueado por tentativas de CPF',
      );
    }
    return attempts;
  }

  isBlocked(phone: string): Promise<boolean> {
    return this.cache.exists({ prefix: BLOCKED_PREFIX, key: phone });
  }

  async scheduleReminder(phone: string, at: Date): Promise<void> {
    await this.cache.scheduleAdd({ set: REMINDER_SET, member: phone, at: at.getTime() });
  }

  async cancelReminder(phone: string): Promise<void> {
    await this.cache.scheduleRemove({ set: REMINDER_SET, member: phone });
  }

  async dueReminders(now: Date, limit = 50): Promise<{ phone: string; at: number }[]> {
    const due = await this.cache.scheduleDue({
      set: REMINDER_SET,
      upTo: now.getTime(),
      limit,
    });
    return due.map(({ member, at }) => ({ phone: member, at }));
  }

  claimReminder(phone: string, at: number): Promise<boolean> {
    return this.cache.scheduleClaim({ set: REMINDER_SET, member: phone, at });
  }

  async tryPhoneLock<T>(
    phone: string,
    work: () => Promise<T>,
  ): Promise<{ ran: true; value: T } | { ran: false }> {
    const token = randomUUID();
    const acquired = await this.cache.setIfAbsent({
      prefix: LOCK_PREFIX,
      key: phone,
      value: token,
      ttl: LOCK_TTL_SECONDS,
    });
    if (!acquired) return { ran: false };
    try {
      return { ran: true, value: await work() };
    } finally {
      await this.cache.deleteIfEquals({ prefix: LOCK_PREFIX, key: phone, value: token });
    }
  }

  async withPhoneLock<T>(phone: string, work: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const acquired = await this.acquireLock(phone, token);
    try {
      return await work();
    } finally {
      if (acquired) {
        await this.cache.deleteIfEquals({ prefix: LOCK_PREFIX, key: phone, value: token });
      }
    }
  }

  private async acquireLock(phone: string, token: string): Promise<boolean> {
    const deadline = Date.now() + LOCK_MAX_WAIT_MS;
    while (true) {
      const acquired = await this.cache.setIfAbsent({
        prefix: LOCK_PREFIX,
        key: phone,
        value: token,
        ttl: LOCK_TTL_SECONDS,
      });
      if (acquired) return true;
      if (Date.now() >= deadline) {
        this.logger.warn(
          { component: 'conversation', from: maskPhone(phone) },
          'Lock do telefone não liberou a tempo; seguindo sem ele',
        );
        return false;
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}
