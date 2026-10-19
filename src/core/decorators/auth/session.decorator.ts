import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { auth } from 'src/modules/auth/auth';

export type AuthenticatedRequest = FastifyRequest & {
  session: Awaited<ReturnType<typeof auth.api.getSession>>;
};

export const Session = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.session;
});
