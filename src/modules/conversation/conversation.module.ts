import { Module } from '@nestjs/common';
import { CacheModule } from 'src/infra/cache/cache.module';
import { WhatsappModule } from 'src/integrations/whatsapp/whatsapp.module';
import { ConversationController } from './conversation.controller';
import { ConversationRepository } from './conversation.repository';
import { ConversationService } from './conversation.service';
import { MessagingGateway } from './messaging.gateway';

@Module({
  imports: [WhatsappModule, CacheModule],
  controllers: [ConversationController],
  providers: [ConversationService, ConversationRepository, MessagingGateway],
})
export class ConversationModule {}
