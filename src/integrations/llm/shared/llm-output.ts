import { z } from 'zod';
import { LlmInvalidOutputError, LlmRejectedError } from '../../../core/erros/llm/llm.errors';

const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

export function validateLlmObject<T>(value: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  throw new LlmInvalidOutputError(
    result.error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  );
}

export function parseLlmObject<T>(content: string, schema: z.ZodType<T>): T {
  const trimmed = content.trim();
  const unfenced = FENCE.exec(trimmed)?.[1] ?? trimmed;
  let value: unknown;
  try {
    value = JSON.parse(unfenced);
  } catch {
    throw new LlmInvalidOutputError([{ path: '', message: 'JSON inválido' }]);
  }
  return validateLlmObject(value, schema);
}

export function toResponseJsonSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
    return rest;
  } catch {
    throw new LlmRejectedError('Schema não representável em JSON Schema');
  }
}
