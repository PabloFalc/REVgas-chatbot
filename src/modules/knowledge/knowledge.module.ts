import { Module } from '@nestjs/common';
import { env } from '../../config/env';
import { DatabaseModule } from '../../infra/database/database.module';
import { LlmModule } from '../../integrations/llm/llm.module';
import { AnswerGateway } from './answer.gateway';
import { EmbeddingGateway } from './embedding.gateway';
import { KNOWLEDGE_CONFIG, resolveKnowledgeConfig } from './knowledge.config';
import { KnowledgeRepository } from './knowledge.repository';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeIngestService } from './knowledge-ingest.service';

@Module({
  imports: [DatabaseModule, LlmModule],
  providers: [
    KnowledgeRepository,
    EmbeddingGateway,
    AnswerGateway,
    KnowledgeIngestService,
    KnowledgeService,
    { provide: KNOWLEDGE_CONFIG, useFactory: () => resolveKnowledgeConfig(env) },
  ],
  exports: [KnowledgeIngestService, KnowledgeService],
})
export class KnowledgeModule {}
