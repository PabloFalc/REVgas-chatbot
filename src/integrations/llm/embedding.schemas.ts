import { z } from 'zod';
import type { LlmUsage } from './llm.schemas';

export interface EmbeddingRequest {
  operation: string;
  input: string[];
  timeoutMs?: number;
}

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  usage: LlmUsage;
  durationMs: number;
}

export const embeddingResponseSchema = z.object({
  model: z.string().optional(),
  data: z.array(
    z.object({
      index: z.number().int().nonnegative().optional(),
      embedding: z.array(z.number()),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
    })
    .nullish(),
});

export type EmbeddingResponse = z.infer<typeof embeddingResponseSchema>;
