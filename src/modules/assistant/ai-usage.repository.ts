import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import { RedisService } from 'src/infra/cache/redis.service';

export const AI_USAGE_PREFIX = 'assistant:ai-usage';
const AI_USAGE_TTL_SECONDS = 3_600;

@Injectable()
export class AiUsageRepository {
  constructor(
    private readonly cache: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AiUsageRepository.name);
  }

  async consume(phone: string, cost: number): Promise<boolean> {
    try {
      let count = 0;
      for (let i = 0; i < cost; i++) {
        count = await this.cache.increment({
          prefix: AI_USAGE_PREFIX,
          key: phone,
          ttl: AI_USAGE_TTL_SECONDS,
        });
      }
      return count <= env.AI_CALLS_PER_PHONE_HOUR;
    } catch (error) {
      this.logger.warn(
        {
          component: 'assistant',
          error: error instanceof Error ? error.name : 'unknown',
        },
        'Falha ao contar chamadas de IA; chamada bloqueada',
      );
      return false;
    }
  }
}
