import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ForbiddenError, UnauthorizedError } from 'src/core/erros/http.errors';
import { getRequestHeaders } from 'src/core/shared/request-headers';
import { auth } from 'src/modules/auth/auth';
import {
  IS_ALLOW_ANONYMOUS,
  IS_ALLOW_UNVERIFIED,
  IS_PUBLIC,
} from '../decorators/auth/auth-metadata.decorator';
import { AuthenticatedRequest } from '../decorators/auth/session.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const isAnonymous = this.reflector.getAllAndOverride<boolean>(IS_ALLOW_ANONYMOUS, [
      context.getHandler(),
      context.getClass(),
    ]);

    const session = await auth.api.getSession({
      headers: getRequestHeaders(request),
    });

    if (session?.user) request.session = session;

    if (isAnonymous) return true;

    if (!session?.user) {
      throw new UnauthorizedError({ message: 'Sessão inválida ou expirada' });
    }

    const allowUnverified = this.reflector.getAllAndOverride<boolean>(IS_ALLOW_UNVERIFIED, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!allowUnverified && !session.user.emailVerified) {
      throw new ForbiddenError({ message: 'Confirme seu email para acessar este recurso' });
    }

    return true;
  }
}

export const authGuard = {
  provide: APP_GUARD,
  useClass: AuthGuard,
};
