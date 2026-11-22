import { Module } from '@nestjs/common';
import { CacheModule } from '../../infra/cache/cache.module';
import { LlmModule } from '../../integrations/llm/llm.module';
import { AiUsageRepository } from './ai-usage.repository';
import { AssistantService } from './assistant.service';

@Module({
  imports: [LlmModule, CacheModule],
  providers: [AssistantService, AiUsageRepository],
  exports: [AssistantService, AiUsageRepository],
})
export class AssistantModule {}
