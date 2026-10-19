import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { z } from 'zod';
import { BadRequestError } from '../erros/http.errors';
import { ZodResponseInterceptor } from './zod-response.interceptor';

describe('ZodResponseInterceptor', () => {
  function createContext(statusCode: number): ExecutionContext {
    return {
      switchToHttp: () => ({
        getResponse: () => ({ statusCode }),
      }),
    } as unknown as ExecutionContext;
  }

  function createNext(data: unknown): CallHandler<unknown> {
    return {
      handle: () => of(data),
    };
  }

  it('deve validar e retornar a resposta quando houver schema para o status', async () => {
    const interceptor = new ZodResponseInterceptor({
      200: z.object({
        id: z.string(),
        name: z.string(),
      }),
    });

    const result = await firstValueFrom(
      interceptor.intercept(createContext(200), createNext({ id: '1', name: 'User Test' })),
    );

    expect(result).toEqual({ id: '1', name: 'User Test' });
  });

  it('deve retornar os dados sem validar quando nao houver schema para o status', async () => {
    const interceptor = new ZodResponseInterceptor({
      201: z.object({
        id: z.string(),
      }),
    });
    const data = { qualquer: 'valor' };

    const result = await firstValueFrom(
      interceptor.intercept(createContext(200), createNext(data)),
    );

    expect(result).toBe(data);
  });

  it('deve lancar BadRequestError quando a resposta nao bater com o schema', async () => {
    const interceptor = new ZodResponseInterceptor({
      200: z.object({
        id: z.string(),
      }),
    });

    await expect(
      firstValueFrom(interceptor.intercept(createContext(200), createNext({ id: 123 }))),
    ).rejects.toThrow(BadRequestError);
  });
});
