import 'reflect-metadata';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { closeDatabasePool } from '../infra/database/drizzle-client';
import { EMBEDDING_CLIENT, type EmbeddingClient } from '../integrations/llm/embedding.client';
import { KNOWLEDGE_CONFIG, type KnowledgeConfig } from '../modules/knowledge/knowledge.config';
import { KnowledgeModule } from '../modules/knowledge/knowledge.module';
import { loadKnowledgeDocuments } from '../modules/knowledge/knowledge-files';
import { KnowledgeIngestService } from '../modules/knowledge/knowledge-ingest.service';
import { formatCliError, parseIngestArgs } from './kb-ingest.args';

async function main(): Promise<void> {
  const args = parseIngestArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(KnowledgeModule, { logger: false });
  try {
    const config = app.get<KnowledgeConfig>(KNOWLEDGE_CONFIG);
    const embeddingClient = app.get<EmbeddingClient>(EMBEDDING_CLIENT);
    if (embeddingClient.model === 'fake') {
      console.warn('Aviso: modo fake, os vetores são simulados e não servem para busca real.');
    }

    const dir = resolve(process.cwd(), args.dir ?? config.dir);
    const documents = await loadKnowledgeDocuments(dir);
    const report = await app.get(KnowledgeIngestService).ingest(documents, { force: args.force });
    console.log(
      `Base ingerida: modelo=${report.model} adicionados=${report.added} atualizados=${report.updated} inalterados=${report.unchanged} removidos=${report.removed}`,
    );
  } finally {
    await app.close();
    await closeDatabasePool();
  }
}

main().catch((error: unknown) => {
  console.error(formatCliError(error));
  process.exitCode = 1;
});
