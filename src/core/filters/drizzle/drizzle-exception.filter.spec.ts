import type { ArgumentsHost } from '@nestjs/common';
import { DrizzleQueryError, TransactionRollbackError } from 'drizzle-orm';
import type { PinoLogger } from 'nestjs-pino';
import { DatabaseError } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { DrizzleExceptionFilter, toAppError } from './drizzle-exception.filter';

const logger = {
  setContext: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as PinoLogger;

function pgError(code: string) {
  const error = new DatabaseError('pg error', 0, 'error');
  error.code = code;
  return error;
}

function queryError(cause?: Error) {
  return new DrizzleQueryError('insert into "orders" ...', ['12345678900'], cause);
}

function makeHost() {
  const reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({ url: '/orders' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, reply };
}

describe('toAppError', () => {
  it.each([
    ['23505', 409, 'CONFLICT'],
    ['23503', 409, 'CONFLICT'],
    ['23502', 400, 'BAD_REQUEST'],
    ['22P02', 400, 'BAD_REQUEST'],
    ['40001', 409, 'CONFLICT'],
    ['08006', 503, 'SERVICE_UNAVAILABLE'],
    ['57P01', 503, 'SERVICE_UNAVAILABLE'],
    ['42P01', 500, 'INTERNAL_SERVER_ERROR'],
  ])('mapeia o código Postgres %s para %i', (code, status, appCode) => {
    const error = toAppError(queryError(pgError(code)));
    expect(error.statusCode).toBe(status);
    expect(error.code).toBe(appCode);
  });

  it('mapeia falha de conexão para 503', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(toAppError(queryError(cause)).statusCode).toBe(503);
  });

  it('mapeia rollback de transação para 409', () => {
    expect(toAppError(new TransactionRollbackError()).statusCode).toBe(409);
  });

  it('usa 500 quando não há causa conhecida', () => {
    expect(toAppError(queryError()).statusCode).toBe(500);
  });
});

describe('DrizzleExceptionFilter', () => {
  const filter = new DrizzleExceptionFilter(logger);

  it('responde com o status mapeado sem expor os parâmetros da query', () => {
    const { host, reply } = makeHost();

    filter.catch(queryError(pgError('23505')), host);

    expect(reply.status).toHaveBeenCalledWith(409);
    const body = reply.send.mock.calls[0][0];
    expect(body).toMatchObject({ statusCode: 409, code: 'CONFLICT', path: '/orders' });
    expect(JSON.stringify(body)).not.toContain('12345678900');
  });
});
