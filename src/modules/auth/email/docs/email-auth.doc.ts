import type { ApiDocParams } from 'src/core/decorators/api-doc/api-doc.decorator';
import { authTokenSchema } from 'src/core/shared/session.dto';
import z from 'zod';
import { SignInWithEmail, SignUpWithEmail } from '../dtos/auth.dto';
import { ChangePasswordDto } from '../dtos/change-password.dto';
import { ForgetPasswordDto, ResetPasswordDto } from '../dtos/password-reset.dto';
import { VerifyEmailDto } from '../dtos/verify-email.dto';

const statusSchema = z.object({ status: z.boolean() }).describe('StatusResponse');

const verifyEmailCallbackQuerySchema = z
  .object({
    token: z.string(),
    callbackURL: z.url(),
  })
  .describe('VerifyEmailCallbackQuery');

export const signUpWithEmailDoc: ApiDocParams = {
  summary: 'SignUp',
  description: 'Registra um usuário e retorna o token Bearer da sessão',
  statusCode: 201,
  response: {
    201: authTokenSchema,
  },
  body: SignUpWithEmail,
};

export const signInWithEmailDoc: ApiDocParams = {
  summary: 'SignIn',
  description: 'Autentica o usuário por email e senha e retorna o token Bearer da sessão',
  body: SignInWithEmail,
  statusCode: 200,
  response: {
    200: authTokenSchema,
  },
};

export const forgetPasswordDoc: ApiDocParams = {
  summary: 'ForgetPassword',
  description: 'Envia um email com o link de redefinição de senha',
  body: ForgetPasswordDto,
  statusCode: 200,
  response: {
    200: statusSchema,
  },
};

export const resetPasswordDoc: ApiDocParams = {
  summary: 'ResetPassword',
  description: 'Redefine a senha do usuário a partir do token recebido por email',
  body: ResetPasswordDto,
  statusCode: 200,
  response: {
    200: statusSchema,
  },
};

export const changePasswordDoc: ApiDocParams = {
  summary: 'ChangePassword',
  description: 'Troca a senha do usuário autenticado (exige a senha atual)',
  body: ChangePasswordDto,
  security: { bearer: true },
  statusCode: 200,
};

export const verifyEmailDoc: ApiDocParams = {
  summary: 'VerifyEmail',
  description: 'Reenvia o email de verificação para o usuário autenticado (email vem da sessão)',
  body: VerifyEmailDto,
  security: { bearer: true },
  statusCode: 200,
  response: {
    200: statusSchema,
  },
};

export const verifyEmailCallbackDoc: ApiDocParams = {
  summary: 'VerifyEmailCallback',
  description:
    'Rota apontada pelo link do email: consome o token e marca o email como verificado. ' +
    'Sempre redireciona (302) para o callbackURL informado no link; sem callbackURL responde 400.',
  query: verifyEmailCallbackQuerySchema,
  statusCode: 302,
};
