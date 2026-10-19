import type { ApiDocParams } from 'src/core/decorators/api-doc/api-doc.decorator';
import z from 'zod';
import { ChangeEmailDto, DeleteAccountDto, UpdateProfileDto } from '../dtos/user.dto';

const statusSchema = z.object({ status: z.boolean() }).describe('StatusResponse');

export const updateProfileDoc: ApiDocParams = {
  summary: 'UpdateProfile',
  description: 'Atualiza nome, userName ou imagem do usuário autenticado',
  body: UpdateProfileDto,
  security: { bearer: true },
  statusCode: 200,
  response: { 200: statusSchema },
};

export const changeEmailDoc: ApiDocParams = {
  summary: 'ChangeEmail',
  description: 'Solicita a troca de email; envia verificação para o email atual aprovar a mudança',
  body: ChangeEmailDto,
  security: { bearer: true },
  statusCode: 200,
  response: { 200: statusSchema },
};

export const deleteAccountDoc: ApiDocParams = {
  summary: 'DeleteAccount',
  description: 'Exclui a conta do usuário autenticado (exige a senha atual)',
  body: DeleteAccountDto,
  security: { bearer: true },
  statusCode: 200,
};
