import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DrizzleError, DrizzleQueryError, TransactionRollbackError } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';
import { DatabaseError } from 'pg';
import type { AppError } from 'src/core/erros/base-app.error';
import { debugDetails } from 'src/core/erros/debug-details';
import {
  BadRequestError,
  ConflictError,
  InternalServerError,
  ServiceUnavailableError,
} from 'src/core/erros/http.errors';

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

export function toAppError(exception: unknown): AppError {
  if (exception instanceof TransactionRollbackError) {
    return new ConflictError({ message: 'Transação revertida' });
  }

  const cause = exception instanceof DrizzleQueryError ? exception.cause : undefined;

  if (cause instanceof DatabaseError) {
    return fromPostgresCode(cause.code);
  }

  const causeCode = (cause as { code?: unknown } | undefined)?.code;
  if (typeof causeCode === 'string' && CONNECTION_ERROR_CODES.has(causeCode)) {
    return new ServiceUnavailableError({ message: 'Banco de dados indisponível' });
  }

  return new InternalServerError();
}

function fromPostgresCode(code: string | undefined): AppError {
  if (!code) return new InternalServerError();

  if (code === '23505') return new ConflictError({ message: 'Registro duplicado' });
  if (code === '23503')
    return new ConflictError({ message: 'Registro relacionado não encontrado' });
  if (code.startsWith('23')) return new BadRequestError({ message: 'Violação de restrição' });
  if (code.startsWith('22')) return new BadRequestError({ message: 'Dado inválido' });
  if (code.startsWith('40')) return new ConflictError({ message: 'Conflito de concorrência' });
  if (code.startsWith('08') || code.startsWith('53') || code.startsWith('57')) {
    return new ServiceUnavailableError({ message: 'Banco de dados indisponível' });
  }

  return new InternalServerError();
}

@Catch(DrizzleQueryError, DrizzleError)
export class DrizzleExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(DrizzleExceptionFilter.name);
  }

  catch(exception: DrizzleQueryError | DrizzleError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const error = toAppError(exception);
    const query = exception instanceof DrizzleQueryError ? exception.query : undefined;
    const cause = exception instanceof DrizzleQueryError ? exception.cause : undefined;
    const pgCode = cause instanceof DatabaseError ? cause.code : undefined;

    const log = { name: exception.name, code: error.code, pgCode, query };
    if (error.statusCode >= 500) {
      this.logger.error({ ...log, err: cause ?? exception }, error.message);
    } else {
      this.logger.warn(log, error.message);
    }

    return reply.status(error.statusCode).send({
      name: error.name,
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      timestamp: error.timestamp,
      details: debugDetails({ pgCode, query, cause: cause?.message }),
      path: request.url,
    });
  }
}

export const drizzleExceptionFilter = {
  provide: APP_FILTER,
  useClass: DrizzleExceptionFilter,
};
