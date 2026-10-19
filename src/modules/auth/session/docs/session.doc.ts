import type { ApiDocParams } from 'src/core/decorators/api-doc/api-doc.decorator';
import { sessionSchema } from 'src/core/shared/session.dto';
import { RevokeSessionDto } from '../dtos/session.dto';

export const getSessionDoc: ApiDocParams = {
  summary: 'GetSession',
  description: 'Retorna a sessão atual do usuário',
  security: { bearer: true },
  statusCode: 200,
  response: { 200: sessionSchema },
};

export const signOutDoc: ApiDocParams = {
  summary: 'SignOut',
  description: 'Encerra a sessão do token atual',
  security: { bearer: true },
  statusCode: 200,
};

export const listSessionsDoc: ApiDocParams = {
  summary: 'ListSessions',
  description: 'Lista as sessões ativas do usuário autenticado',
  security: { bearer: true },
  statusCode: 200,
};

export const revokeSessionDoc: ApiDocParams = {
  summary: 'RevokeSession',
  description: 'Revoga uma sessão específica pelo token',
  body: RevokeSessionDto,
  security: { bearer: true },
  statusCode: 200,
};

export const revokeOtherSessionsDoc: ApiDocParams = {
  summary: 'RevokeOtherSessions',
  description: 'Revoga todas as outras sessões do usuário, mantendo a atual',
  security: { bearer: true },
  statusCode: 200,
};
