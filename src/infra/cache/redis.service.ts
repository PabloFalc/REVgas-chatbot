import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import type { CacheGetParams, CacheSetParams, ICacheClient } from './cache-client.interface';
import { REDIS } from './redis.client';

const DELETE_IF_EQUALS =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const CLAIM_IF_SCORE_EQUALS =
  "if redis.call('zscore', KEYS[1], ARGV[1]) == ARGV[2] then return redis.call('zrem', KEYS[1], ARGV[1]) else return 0 end";

@Injectable()
export class RedisService implements ICacheClient, OnApplicationShutdown {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RedisService.name);
  }

  async get<T>(params: CacheGetParams): Promise<T | null> {
    const { key, prefix } = params;
    try {
      const result = await this.redis.get(this._makePrefix(key, prefix));
      if (!result) return null;
      return JSON.parse(result) as T;
    } catch (error) {
      this.logger.error({ component: 'cache', err: error, prefix }, 'Cache get error');
      return null;
    }
  }

  async set(params: CacheSetParams): Promise<void> {
    const { key, value, ttl, prefix } = params;
    try {
      const serialized = JSON.stringify(value);
      const keyWithPrefix = this._makePrefix(key, prefix);
      if (ttl) {
        await this.redis.setex(keyWithPrefix, ttl, serialized);
      } else {
        await this.redis.set(keyWithPrefix, serialized);
      }
    } catch (error) {
      this.logger.error({ component: 'cache', err: error, prefix }, 'Cache set error');
    }
  }

  async setIfAbsent(params: CacheSetParams): Promise<boolean> {
    const { key, value, ttl, prefix } = params;
    const keyWithPrefix = this._makePrefix(key, prefix);
    const serialized = JSON.stringify(value);
    const result = ttl
      ? await this.redis.set(keyWithPrefix, serialized, 'EX', ttl, 'NX')
      : await this.redis.set(keyWithPrefix, serialized, 'NX');
    return result === 'OK';
  }

  async exists(params: CacheGetParams): Promise<boolean> {
    const { key, prefix } = params;
    try {
      return (await this.redis.exists(this._makePrefix(key, prefix))) === 1;
    } catch (error) {
      this.logger.error({ component: 'cache', err: error, prefix }, 'Cache exists error');
      return false;
    }
  }

  async delete(params: CacheGetParams): Promise<void> {
    const { key, prefix } = params;
    try {
      await this.redis.del(this._makePrefix(key, prefix));
    } catch (error) {
      this.logger.error({ component: 'cache', err: error, prefix }, 'Cache delete error');
    }
  }

  async deleteIfEquals(params: CacheGetParams & { value: unknown }): Promise<boolean> {
    const { key, prefix, value } = params;
    try {
      const result = await this.redis.eval(
        DELETE_IF_EQUALS,
        1,
        this._makePrefix(key, prefix),
        JSON.stringify(value),
      );
      return result === 1;
    } catch (error) {
      this.logger.error({ component: 'cache', err: error, prefix }, 'Cache deleteIfEquals error');
      return false;
    }
  }

  async setKeepTtl(params: CacheGetParams & { value: unknown }): Promise<void> {
    const { key, prefix, value } = params;
    await this.redis.set(this._makePrefix(key, prefix), JSON.stringify(value), 'KEEPTTL', 'XX');
  }

  async increment(params: CacheGetParams & { ttl: number }): Promise<number> {
    const { key, prefix, ttl } = params;
    const keyWithPrefix = this._makePrefix(key, prefix);
    const count = await this.redis.incr(keyWithPrefix);
    if (count === 1) {
      await this.redis.expire(keyWithPrefix, ttl);
    }
    return count;
  }

  async scheduleAdd(params: { set: string; member: string; at: number }): Promise<void> {
    await this.redis.zadd(params.set, params.at, params.member);
  }

  async scheduleDue(params: {
    set: string;
    upTo: number;
    limit: number;
  }): Promise<{ member: string; at: number }[]> {
    const flat = await this.redis.zrangebyscore(
      params.set,
      '-inf',
      params.upTo,
      'WITHSCORES',
      'LIMIT',
      0,
      params.limit,
    );
    const due: { member: string; at: number }[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      due.push({ member: flat[i], at: Number(flat[i + 1]) });
    }
    return due;
  }

  async scheduleClaim(params: { set: string; member: string; at: number }): Promise<boolean> {
    const result = await this.redis.eval(
      CLAIM_IF_SCORE_EQUALS,
      1,
      params.set,
      params.member,
      String(params.at),
    );
    return result === 1;
  }

  async scheduleRemove(params: { set: string; member: string }): Promise<void> {
    await this.redis.zrem(params.set, params.member);
  }

  async clear(prefix: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 100);

        if (keys.length > 0) {
          await this.redis.unlink(...keys);
        }

        cursor = next;
      } while (cursor !== '0');
    } catch (error) {
      this.logger.error({ component: 'cache', err: error }, 'Cache clear error');
    }
  }

  withPrefix(prefix: string): ICacheClient {
    return {
      get: params => this.get({ ...params, prefix }),
      set: params => this.set({ ...params, prefix }),
      setIfAbsent: params => this.setIfAbsent({ ...params, prefix }),
      exists: params => this.exists({ ...params, prefix }),
      deleteIfEquals: params => this.deleteIfEquals({ ...params, prefix }),
      delete: params => this.delete({ ...params, prefix }),
      clear: () => this.clear(prefix),
    };
  }

  private _makePrefix(key: string, prefix?: string): string {
    return prefix ? `${prefix}:${key}` : key;
  }

  async onApplicationShutdown(signal?: string) {
    this.logger.info({ component: 'cache' }, `Encerrando conexão Redis (${signal ?? 'shutdown'})`);
    await this.redis.quit();
  }
}
