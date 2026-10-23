import { Module } from '@nestjs/common';
import { CacheModule } from 'src/infra/cache/cache.module';
import { LlmModule } from 'src/integrations/llm/llm.module';
import { RevgasModule } from 'src/integrations/revgas/revgas.module';
import { ViacepModule } from 'src/integrations/viacep/viacep.module';
import { WhatsappModule } from 'src/integrations/whatsapp/whatsapp.module';
import { AddressModule } from '../address/address.module';
import { AssistantModule } from '../assistant/assistant.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomerModule } from '../customer/customer.module';
import { OrderModule } from '../order/order.module';
import { ConversationController } from './conversation.controller';
import { ConversationRepository } from './conversation.repository';
import { ConversationService } from './conversation.service';
import { FlowToolsService } from './flow-tools';
import { MessagingGateway } from './messaging.gateway';
import { ReminderScheduler } from './reminder.scheduler';

@Module({
  imports: [
    WhatsappModule,
    CacheModule,
    CustomerModule,
    CatalogModule,
    OrderModule,
    AddressModule,
    AssistantModule,
    RevgasModule,
    LlmModule,
    ViacepModule,
  ],
  controllers: [ConversationController],
  providers: [
    ConversationService,
    ConversationRepository,
    MessagingGateway,
    FlowToolsService,
    ReminderScheduler,
  ],
})
export class ConversationModule {}
