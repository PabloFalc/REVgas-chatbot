export interface KnowledgeDocument {
  source: string;
  markdown: string;
}

export interface KnowledgeChunkDraft {
  key: string;
  source: string;
  title: string;
  content: string;
  embeddingText: string;
  searchText: string;
  hash: string;
}

export interface Candidate {
  id: string;
  source: string;
  title: string;
  content: string;
  similarity: number;
}

export interface RankedChunk extends Candidate {
  score: number;
  matchedText: boolean;
}

export interface FuseOptions {
  topK: number;
  minSimilarity: number;
  minSimilarityWithText: number;
}

export interface StoredChunk {
  key: string;
  source: string;
  title: string;
  content: string;
  searchText: string;
  hash: string;
  model: string;
  dimensions: number;
  embedding: number[];
}

export interface IndexedChunk {
  key: string;
  hash: string;
  model: string;
  dimensions: number;
}

export interface AnswerSource {
  ref: string;
  title: string;
  content: string;
}

export interface DraftAnswer {
  answer: string | null;
  sources: string[];
}

export type AnswerRejection =
  | 'empty'
  | 'too_long'
  | 'no_sources'
  | 'unknown_source'
  | 'money'
  | 'percent'
  | 'price_claim'
  | 'number_not_in_sources';

export type KnowledgeAnswer =
  | { kind: 'answered'; text: string; sources: string[] }
  | { kind: 'unknown'; reason: 'no_match' | 'not_in_sources' | 'rejected' | 'unavailable' };

export type SearchOutcome = { status: 'ok'; chunks: RankedChunk[] } | { status: 'unavailable' };
