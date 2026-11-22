import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const verificationQuerySchema = z.object({
  'hub.mode': z.string().max(32).optional(),
  'hub.verify_token': z.string().max(256).optional(),
  'hub.challenge': z.string().max(256).optional(),
});

export class VerificationQueryDto extends createZodDto(verificationQuerySchema) {}
