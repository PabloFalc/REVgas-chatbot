import { Inject, Injectable } from '@nestjs/common';
import { cosineDistance, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from 'src/infra/database/drizzle-client';
import type * as schema from 'src/infra/database/schemas/index';
import { knowledgeChunks } from 'src/infra/database/schemas/knowledge/knowledge-chunks.table';
import type { Candidate, IndexedChunk, StoredChunk } from './contracts/knowledge.types';

export interface CandidateQuery {
  embedding: number[];
  textQuery: string | null;
  model: string;
  limit: number;
}

@Injectable()
export class KnowledgeRepository {
  constructor(@Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>) {}

  async listIndex(): Promise<IndexedChunk[]> {
    return this.db
      .select({
        key: knowledgeChunks.chunkKey,
        hash: knowledgeChunks.contentHash,
        model: knowledgeChunks.embeddingModel,
        dimensions: knowledgeChunks.embeddingDimensions,
      })
      .from(knowledgeChunks);
  }

  async apply(changes: { upsert: StoredChunk[]; remove: string[] }): Promise<void> {
    if (changes.upsert.length === 0 && changes.remove.length === 0) return;

    await this.db.transaction(async tx => {
      if (changes.remove.length > 0) {
        await tx.delete(knowledgeChunks).where(inArray(knowledgeChunks.chunkKey, changes.remove));
      }
      if (changes.upsert.length > 0) {
        await tx
          .insert(knowledgeChunks)
          .values(
            changes.upsert.map(chunk => ({
              chunkKey: chunk.key,
              source: chunk.source,
              title: chunk.title,
              content: chunk.content,
              searchText: chunk.searchText,
              contentHash: chunk.hash,
              embeddingModel: chunk.model,
              embeddingDimensions: chunk.dimensions,
              embedding: chunk.embedding,
            })),
          )
          .onConflictDoUpdate({
            target: knowledgeChunks.chunkKey,
            set: {
              source: sql`excluded.source`,
              title: sql`excluded.title`,
              content: sql`excluded.content`,
              searchText: sql`excluded.search_text`,
              contentHash: sql`excluded.content_hash`,
              embeddingModel: sql`excluded.embedding_model`,
              embeddingDimensions: sql`excluded.embedding_dimensions`,
              embedding: sql`excluded.embedding`,
              updatedAt: sql`now()`,
            },
          });
      }
    });
  }

  async findCandidates(
    query: CandidateQuery,
  ): Promise<{ byVector: Candidate[]; byText: Candidate[] }> {
    const distance = cosineDistance(knowledgeChunks.embedding, query.embedding);
    const columns = {
      id: knowledgeChunks.id,
      source: knowledgeChunks.source,
      title: knowledgeChunks.title,
      content: knowledgeChunks.content,
      similarity: sql<number>`1 - (${distance})`,
    };
    const sameModel = eq(knowledgeChunks.embeddingModel, query.model);

    const vectorRows = await this.db
      .select(columns)
      .from(knowledgeChunks)
      .where(sameModel)
      .orderBy(distance)
      .limit(query.limit);

    let textRows: typeof vectorRows = [];
    if (query.textQuery) {
      const tsQuery = sql`to_tsquery('portuguese', ${query.textQuery})`;
      const tsVector = sql`to_tsvector('portuguese', ${knowledgeChunks.searchText})`;
      textRows = await this.db
        .select(columns)
        .from(knowledgeChunks)
        .where(sql`${sameModel} and ${tsVector} @@ ${tsQuery}`)
        .orderBy(desc(sql`ts_rank_cd(${tsVector}, ${tsQuery})`))
        .limit(query.limit);
    }

    const toCandidate = (row: (typeof vectorRows)[number]): Candidate => ({
      ...row,
      similarity: Number(row.similarity),
    });

    return { byVector: vectorRows.map(toCandidate), byText: textRows.map(toCandidate) };
  }
}
