import type { Env } from '../../config/env';

export const KNOWLEDGE_CONFIG = Symbol('KNOWLEDGE_CONFIG');

export interface KnowledgeConfig {
  dir: string;
  topK: number;
  minSimilarity: number;
  minSimilarityWithText: number;
}

export function resolveKnowledgeConfig(env: Env): KnowledgeConfig {
  if (env.KNOWLEDGE_MIN_SIMILARITY_TEXT > env.KNOWLEDGE_MIN_SIMILARITY) {
    throw new Error(
      'KNOWLEDGE_MIN_SIMILARITY_TEXT não pode ser maior que KNOWLEDGE_MIN_SIMILARITY',
    );
  }
  return {
    dir: env.KNOWLEDGE_DIR,
    topK: env.KNOWLEDGE_TOP_K,
    minSimilarity: env.KNOWLEDGE_MIN_SIMILARITY,
    minSimilarityWithText: env.KNOWLEDGE_MIN_SIMILARITY_TEXT,
  };
}
