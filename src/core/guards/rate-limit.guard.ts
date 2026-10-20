import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { type ExecutionContext, Injectable } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, type ThrottlerLimitDetail, ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { env } from 'src/config/env';
import { CacheModule } from 'src/infra/cache/cache.module';
import { REDIS } from 'src/infra/cache/redis.client';
import { ThrottlerError } from '../erros/throttler.error';

@Injectable()
class RateLimitGuard extends ThrottlerGuard {
  protected throwThrottlingException(
    _context: ExecutionContext,
    details: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ThrottlerError(details.timeToBlockExpire);
  }
}

const rateLimit = {
  provide: APP_GUARD,
  useClass: RateLimitGuard,
};

const throttler = ThrottlerModule.forRootAsync({
  imports: [CacheModule],
  inject: [REDIS],
  useFactory: (redis: Redis) => ({
    throttlers: [
      {
        name: 'default',
        ttl: 60_000,
        limit: env.NODE_ENV === 'test' ? 9999 : 50,
        blockDuration: 60_000,
      },
    ],
    storage: new ThrottlerStorageRedisService(redis),
  }),
});

const STRICT_AUTH_THROTTLE = {
  default: {
    ttl: 60_000,
    limit: env.NODE_ENV === 'test' ? 9999 : 10,
    blockDuration: 300_000,
  },
};

const HEALTH_THROTTLE = {
  default: {
    ttl: 60_000,
    limit: env.NODE_ENV === 'test' ? 9999 : 120,
  },
};

const WEBHOOK_THROTTLE = {
  default: {
    ttl: 60_000,
    limit: env.NODE_ENV === 'test' ? 9999 : 1_000,
  },
};

export {
  HEALTH_THROTTLE,
  RateLimitGuard,
  rateLimit,
  STRICT_AUTH_THROTTLE,
  throttler,
  WEBHOOK_THROTTLE,
};
