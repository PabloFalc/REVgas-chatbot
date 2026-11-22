import type { EmbeddingRequest, EmbeddingResult } from './embedding.schemas';

export const EMBEDDING_CLIENT = Symbol('EMBEDDING_CLIENT');

export interface EmbeddingClient {
  readonly model: string;
  readonly dimensions: number;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}
