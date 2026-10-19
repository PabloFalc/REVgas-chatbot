import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/env';

// Token
export const REDIS = 'REDIS_CLIENT';

// ! instância única (compartilhada entre o provider DI e o auth.ts, que vive fora do DI)
let client: Redis | null = null;

// ! conexão com o redis
export const redis: () => Redis = () => {
  if (client) return client;

  const logger = new Logger('Redis');

  client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    tls: env.REDIS_TLS ? {} : undefined,
    retryStrategy: times => {
      const delay = Math.min(times * 50, 2000);

      logger.warn(`Redis retry attempt #${times} - reconnecting in ${delay}ms`);

      return delay;
    },
    maxRetriesPerRequest: 3,
  });

  // logging dos eventos
  client.on('connect', () => {
    logger.log('Redis connected');
  });

  client.on('error', (error: Error) => {
    logger.error(error.message, error.stack);
  });

  client.on('close', () => {
    logger.warn('Redis connection closed');
  });

  client.on('reconnecting', () => {
    logger.warn('Redis reconnecting');
  });

  return client;
};

// ? DI do Nest para utilizar como provider
export const redisClient = {
  provide: REDIS,
  useFactory: () => redis(),
};
