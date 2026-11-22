import type { z } from 'zod';
import { RevgasValidationError } from '../../../core/erros/revgas/revgas.errors';

export function parseInput<S extends z.ZodType>(
  schema: S,
  input: z.input<S>,
  message: string,
): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new RevgasValidationError(
      message,
      parsed.error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}
