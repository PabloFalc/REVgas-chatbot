import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { strongPassword } from './password.schema';

export const forgetPasswordSchema = z
  .object({
    email: z.email(),
    redirectTo: z.url(),
  })
  .describe('ForgetPassword');

export type IForgetPassword = z.infer<typeof forgetPasswordSchema>;

export class ForgetPasswordDto extends createZodDto(forgetPasswordSchema) {}

export const resetPasswordSchema = z
  .object({
    newPassword: strongPassword,
    token: z.string(),
  })
  .describe('ResetPassword');

export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
