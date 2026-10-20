import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { RedisService } from 'src/infra/cache/redis.service';

export const INBOUND_PREFIX = 'whatsapp:inbound';
const INBOUND_TTL_SECONDS = 24 * 60 * 60;

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
}
