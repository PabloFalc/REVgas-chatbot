import 'reflect-metadata';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { EMBEDDING_CLIENT, type EmbeddingClient } from '../integrations/llm/embedding.client';
import { KNOWLEDGE_CONFIG, type KnowledgeConfig } from '../modules/knowledge/knowledge.config';
import { KnowledgeModule } from '../modules/knowledge/knowledge.module';
import { loadKnowledgeDocuments } from '../modules/knowledge/knowledge-files';
import { KnowledgeIngestService } from '../modules/knowledge/knowledge-ingest.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(KnowledgeModule, { logger: false });
  try {
    const config = app.get<KnowledgeConfig>(KNOWLEDGE_CONFIG);
    const embeddingClient = app.get<EmbeddingClient>(EMBEDDING_CLIENT);
    if (embeddingClient.model === 'fake') {
      console.warn('Aviso: modo fake, os vetores são simulados e não servem para busca real.');
    }

    const dir = resolve(process.cwd(), process.argv[2] ?? config.dir);
    const documents = await loadKnowledgeDocuments(dir);
    const report = await app.get(KnowledgeIngestService).ingest(documents);
    console.log(
      `Base ingerida: modelo=${report.model} adicionados=${report.added} atualizados=${report.updated} inalterados=${report.unchanged} removidos=${report.removed}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
