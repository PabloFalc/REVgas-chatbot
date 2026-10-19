import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { strongPassword } from './password.schema';

export const changePasswordSchema = z
  .object({
    currentPassword: z.string(),
    newPassword: strongPassword,
    revokeOtherSessions: z.boolean().optional(),
  })
  .describe('ChangePassword');

export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
