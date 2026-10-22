import { Module } from '@nestjs/common';
import { LlmModule } from '../../integrations/llm/llm.module';
import { AssistantService } from './assistant.service';

@Module({
  imports: [LlmModule],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
