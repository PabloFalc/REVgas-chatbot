import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const verifyEmailSchema = z
  .object({
    callbackURL: z.url(),
  })
  .describe('VerifyEmail');

export class VerifyEmailDto extends createZodDto(verifyEmailSchema) {}
