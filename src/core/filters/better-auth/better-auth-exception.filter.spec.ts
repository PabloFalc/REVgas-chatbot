import type { ArgumentsHost } from '@nestjs/common';
import { APIError } from 'better-auth/api';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { BetterAuthExceptionFilter } from './better-auth-exception.filter';

const logger = {
  setContext: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as PinoLogger;

function makeHost(url = '/auth/email/sign-in') {
  const reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({ url }),
    }),
  } as unknown as ArgumentsHost;
  return { host, reply };
}

describe('BetterAuthExceptionFilter', () => {
  const filter = new BetterAuthExceptionFilter(logger);

  it('mapeia 401 para UNAUTHORIZED', () => {
    const { host, reply } = makeHost();
    filter.catch(new APIError('UNAUTHORIZED', { message: 'sem sessão' }), host);
    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, code: 'UNAUTHORIZED', message: 'sem sessão' }),
    );
  });

  it('mapeia 409 para CONFLICT', () => {
    const { host, reply } = makeHost();
    filter.catch(new APIError('CONFLICT', { message: 'duplicado' }), host);
    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it('mapeia status sem mapeamento (418) para 500', () => {
    const { host, reply } = makeHost();
    filter.catch(new APIError("I'M_A_TEAPOT", { message: 'chá' }), host);
    expect(reply.status).toHaveBeenCalledWith(500);
  });

  it('mapeia status sem mapeamento numérico (402) para 500', () => {
    const { host, reply } = makeHost();
    const err = new APIError('BAD_REQUEST', { message: 'x' });
    Object.defineProperty(err, 'statusCode', { value: 402 });
    filter.catch(err, host);
    expect(reply.status).toHaveBeenCalledWith(500);
  });

  it('mapeia 422 para CONFLICT (recurso ja existe)', () => {
    const { host, reply } = makeHost();
    filter.catch(new APIError('UNPROCESSABLE_ENTITY', { message: 'inválido' }), host);
    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFLICT' }));
  });
});
