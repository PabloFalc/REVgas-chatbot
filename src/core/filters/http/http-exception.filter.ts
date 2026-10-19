import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';
import { AppError } from '../../erros/base-app.error';

@Catch(AppError)
class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AppExceptionFilter.name);
  }

  catch(exception: AppError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    if (exception.statusCode === 500) {
      this.logger.error(
        { name: exception.name, code: exception.code, stack: exception.stack },
        exception.message,
      );
    } else {
      this.logger.warn({ name: exception.name, code: exception.code }, exception.message);
    }

    return reply.status(exception.statusCode).send({
      name: exception.name,
      statusCode: exception.statusCode,
      code: exception.code,
      message: exception.message,
      timestamp: exception.timestamp,
      details: exception.details,
      path: request.url,
    });
  }
}

export const httpExceptionFilter = {
  provide: APP_FILTER,
  useClass: AppExceptionFilter,
};
