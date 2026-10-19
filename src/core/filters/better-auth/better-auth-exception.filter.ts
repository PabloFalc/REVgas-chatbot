import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { APIError } from 'better-auth/api';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';
import { AppError } from '../../erros/base-app.error';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from '../../erros/http.errors';

@Catch(APIError)
class BetterAuthExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(BetterAuthExceptionFilter.name);
  }

  catch(exception: APIError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const appError = this.toAppError(exception);

    if (appError.statusCode === 500) {
      this.logger.error(
        { name: exception.name, status: exception.statusCode, stack: exception.stack },
        appError.message,
      );
    } else {
      this.logger.warn({ code: appError.code, status: exception.statusCode }, appError.message);
    }

    return reply.status(appError.statusCode).send({
      name: appError.name,
      statusCode: appError.statusCode,
      code: appError.code,
      message: appError.message,
      timestamp: appError.timestamp,
      path: request.url,
    });
  }

  private toAppError(exception: APIError): AppError {
    const message =
      (exception.body as { message?: string } | undefined)?.message ?? exception.message;

    switch (exception.statusCode) {
      case 400:
        return new BadRequestError({ message });
      case 401:
        return new UnauthorizedError({ message });
      case 403:
        return new ForbiddenError({ message });
      case 404:
        return new NotFoundError({ message });
      case 409:
      case 422:
        return new ConflictError({ message });
      default:
        return new InternalServerError();
    }
  }
}

export const betterAuthExceptionFilter = {
  provide: APP_FILTER,
  useClass: BetterAuthExceptionFilter,
};

export { BetterAuthExceptionFilter };
