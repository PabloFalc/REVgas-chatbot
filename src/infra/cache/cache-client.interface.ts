export type CacheGetParams = {
  key: string;
  prefix: string;
};
export type CacheSetParams = {
  value: unknown;
  ttl?: number;
} & CacheGetParams;

export abstract class ICacheClient {
  abstract get<T>(params: CacheGetParams): Promise<T | null>;

  abstract set(params: CacheSetParams): Promise<void>;

  abstract setIfAbsent(params: CacheSetParams): Promise<boolean>;

  abstract exists(params: CacheGetParams): Promise<boolean>;

  abstract delete(params: CacheGetParams): Promise<void>;

  abstract clear(prefix: string): Promise<void>;
}
