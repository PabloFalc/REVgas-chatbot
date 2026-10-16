import { RedisClient } from "bun";
import { env } from "../../config/env";

export class Cache {
  constructor(
    private readonly client: RedisClient,
    private readonly defaultTtlSeconds: number,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value === null ? null : (JSON.parse(value) as T);
  }

  async set<T>(key: string, value: T, ttlSeconds = this.defaultTtlSeconds): Promise<void> {
    await this.client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  close(): void {
    this.client.close();
  }
}

export const cache = new Cache(new RedisClient(env.CACHE_URL), env.CONVERSATION_TTL_SECONDS);
