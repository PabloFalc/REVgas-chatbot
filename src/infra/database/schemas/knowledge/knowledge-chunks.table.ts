import { sql } from 'drizzle-orm';
import { index, pgTable, vector } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { timestamps } from '../shared/timestamps';

export const KNOWLEDGE_VECTOR_DIMENSIONS = 768;

const { createdAt, updatedAt } = timestamps;

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  t => ({
    id: t
      .text('id')
      .$defaultFn(() => uuidv7())
      .primaryKey(),
    chunkKey: t.text('chunk_key').notNull().unique(),
    source: t.text('source').notNull(),
    title: t.text('title').notNull(),
    content: t.text('content').notNull(),
    searchText: t.text('search_text').notNull(),
    contentHash: t.text('content_hash').notNull(),
    embeddingModel: t.text('embedding_model').notNull(),
    embeddingDimensions: t.integer('embedding_dimensions').notNull(),
    embedding: vector('embedding', { dimensions: KNOWLEDGE_VECTOR_DIMENSIONS }).notNull(),
    createdAt,
    updatedAt,
  }),
  table => [
    index('knowledge_chunks_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
    index('knowledge_chunks_search_idx').using(
      'gin',
      sql`to_tsvector('portuguese', ${table.searchText})`,
    ),
    index('knowledge_chunks_model_idx').on(table.embeddingModel),
  ],
);
