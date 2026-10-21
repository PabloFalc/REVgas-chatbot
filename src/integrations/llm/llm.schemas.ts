import { z } from 'zod';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmTextRequest {
  operation: string;
  messages: LlmMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface LlmObjectRequest<T> extends LlmTextRequest {
  schema: z.ZodType<T>;
  schemaName: string;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmTextResult {
  text: string;
  model: string;
  usage: LlmUsage;
  durationMs: number;
}

export interface LlmObjectResult<T> {
  object: T;
  model: string;
  usage: LlmUsage;
  durationMs: number;
}

export const chatCompletionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .nullish(),
});

export type ChatCompletion = z.infer<typeof chatCompletionSchema>;
