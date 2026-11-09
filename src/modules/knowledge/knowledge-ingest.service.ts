import { Injectable } from '@nestjs/common';
import { createLogger } from '../../config/plugins/pino.config';
import { KnowledgeIngestError } from '../../core/erros/knowledge.errors';
import { KNOWLEDGE_VECTOR_DIMENSIONS } from '../../infra/database/schemas/knowledge/knowledge-chunks.table';
import { chunkDocuments } from './chunker';
import type { KnowledgeDocument, StoredChunk } from './contracts/knowledge.types';
import { EmbeddingGateway } from './embedding.gateway';
import { KnowledgeRepository } from './knowledge.repository';

export interface IngestReport {
  model: string;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
}

const INGEST_OPERATION = 'kb-ingest';
const INGEST_TIMEOUT_MS = 30_000;

@Injectable()
export class KnowledgeIngestService {
  private readonly logger = createLogger('Knowledge');

  constructor(
    private readonly repository: KnowledgeRepository,
    private readonly embeddings: EmbeddingGateway,
  ) {}

  async ingest(documents: KnowledgeDocument[]): Promise<IngestReport> {
    if (this.embeddings.dimensions !== KNOWLEDGE_VECTOR_DIMENSIONS) {
      throw new KnowledgeIngestError(
        `O cliente de embedding gera ${this.embeddings.dimensions} dimensões, mas a tabela usa ${KNOWLEDGE_VECTOR_DIMENSIONS}. É preciso uma migration para trocar a dimensão.`,
      );
    }

    const chunks = chunkDocuments(documents);
    if (chunks.length === 0) {
      throw new KnowledgeIngestError('Nenhuma seção encontrada na base');
    }

    const model = this.embeddings.model;
    const dimensions = this.embeddings.dimensions;
    const indexed = await this.repository.listIndex();
    const indexedByKey = new Map(indexed.map(item => [item.key, item]));

    const changed = chunks.filter(chunk => {
      const current = indexedByKey.get(chunk.key);
      return !(
        current &&
        current.hash === chunk.hash &&
        current.model === model &&
        current.dimensions === dimensions
      );
    });
    const currentKeys = new Set(chunks.map(chunk => chunk.key));
    const remove = indexed.filter(item => !currentKeys.has(item.key)).map(item => item.key);

    const report: IngestReport = {
      model,
      added: changed.filter(chunk => !indexedByKey.has(chunk.key)).length,
      updated: changed.filter(chunk => indexedByKey.has(chunk.key)).length,
      unchanged: chunks.length - changed.length,
      removed: remove.length,
    };

    if (changed.length > 0 || remove.length > 0) {
      const vectors =
        changed.length > 0
          ? await this.embeddings.embed(
              changed.map(chunk => chunk.embeddingText),
              INGEST_OPERATION,
              INGEST_TIMEOUT_MS,
            )
          : [];

      const upsert: StoredChunk[] = changed.map((chunk, index) => ({
        key: chunk.key,
        source: chunk.source,
        title: chunk.title,
        content: chunk.content,
        searchText: chunk.searchText,
        hash: chunk.hash,
        model,
        dimensions,
        embedding: vectors[index],
      }));

      await this.repository.apply({ upsert, remove });
    }

    this.logger.info({ component: 'knowledge', ...report }, 'Base ingerida');
    return report;
  }
}
