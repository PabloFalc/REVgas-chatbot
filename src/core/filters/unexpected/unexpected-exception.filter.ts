import { type ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { APP_FILTER, BaseExceptionFilter } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import { AppError } from 'src/core/erros/base-app.error';
import { InternalServerError } from 'src/core/erros/http.errors';

@Catch()
class UnexpectedExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    super();
    this.logger.setContext(UnexpectedExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof AppError || exception instanceof HttpException) {
      return super.catch(exception, host);
    }

    this.logger.error({ err: exception }, 'Unexpected exception');

    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const error = new InternalServerError({
      message:
        env.NODE_ENV === 'production'
          ? 'Erro interno do servidor'
          : exception instanceof Error
            ? exception.message
            : String(exception),
    });

    return reply.status(500).send({
      name: error.name,
      statusCode: 500,
      code: error.code,
      message: error.message,
      timestamp: error.timestamp,
      path: request.url,
    });
  }
}

export const unexpectedExceptionFilter = {
  provide: APP_FILTER,
  useClass: UnexpectedExceptionFilter,
};
