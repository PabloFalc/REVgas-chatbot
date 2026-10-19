import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { strongPassword } from './password.schema';

//? ---------------- SignUp ----------------\\
export const signUpWithEmailSchema = z
  .object({
    email: z.email(),
    password: strongPassword,
    userName: z.string().min(3).max(32),
    name: z.string().min(2).max(100),
  })
  .describe('SignUpWithEmail');

export type ISignUpWithEmailType = z.infer<typeof signUpWithEmailSchema>;

export class SignUpWithEmail extends createZodDto(signUpWithEmailSchema) {}

//? ---------------- SignIn ----------------\\
export const signInWithEmailSchema = z
  .object({
    email: z.email(),
    password: z.string().min(1),
  })
  .describe('SignInWithEmail');

export type ISignInWithEmail = z.infer<typeof signInWithEmailSchema>;

export class SignInWithEmail extends createZodDto(signInWithEmailSchema) {}
