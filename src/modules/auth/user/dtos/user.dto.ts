import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const updateProfileSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    userName: z.string().min(3).max(32).optional(),
    image: z.url().optional(),
  })
  .describe('UpdateProfile');

export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}

export const changeEmailSchema = z
  .object({
    newEmail: z.email(),
    callbackURL: z.url(),
  })
  .describe('ChangeEmail');

export class ChangeEmailDto extends createZodDto(changeEmailSchema) {}

export const deleteAccountSchema = z
  .object({
    password: z.string().min(1),
  })
  .describe('DeleteAccount');

export class DeleteAccountDto extends createZodDto(deleteAccountSchema) {}
