import { RevgasValidationError } from './revgas.errors';
import { type RevgasSaleInput, RevgasSaleInputSchema } from './revgas.schemas';

export function parseSaleInput(input: RevgasSaleInput) {
  const parsed = RevgasSaleInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new RevgasValidationError(
      'invalid sale input',
      parsed.error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}
