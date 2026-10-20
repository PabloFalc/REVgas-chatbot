import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  RevgasNotFoundError,
  RevgasResponseError,
  RevgasUnavailableError,
  RevgasUnknownOutcomeError,
  RevgasValidationError,
} from '../revgas.errors';
import { RevgasHttp } from './revgas-http';

const API_KEY = 'secret-key-123';
const schema = z.object({ id: z.number() });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function timeout(): DOMException {
  return new DOMException('timeout', 'TimeoutError');
}

function setup(responses: Array<Response | Error>, overrides: Record<string, unknown> = {}) {
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const starts: number[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    starts.push(clock);
    const next = queue.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  const logger = { info: vi.fn(), warn: vi.fn() };
  const http = new RevgasHttp({
    baseUrl: 'https://api.test/v1',
    apiKey: API_KEY,
    timeoutMs: 1000,
    minIntervalMs: 1000,
    logger,
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async ms => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    ...overrides,
  });
  return { http, fetchMock, logger, sleeps, starts };
}

describe('RevgasHttp', () => {
  it('envia Authorization sem Bearer e Content-Type JSON', async () => {
    const { http, fetchMock } = setup([json({ id: 1 })]);
    await http.request({ method: 'GET', path: '/x', schema });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(API_KEY);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('monta a query ignorando undefined', async () => {
    const { http, fetchMock } = setup([json({ id: 1 })]);
    await http.request({
      method: 'GET',
      path: '/x',
      query: { page: 2, a: undefined, inactive: false },
      schema,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.test/v1/x?page=2&inactive=false');
  });

  it('ignora valores de query vazios', async () => {
    const { http, fetchMock } = setup([json({ id: 1 })]);
    await http.request({
      method: 'GET',
      path: '/x',
      query: { phone: '', page: 1 },
      schema,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.test/v1/x?page=1');
  });

  it('envia o corpo JSON em POST', async () => {
    const { http, fetchMock } = setup([json({ id: 1 })]);
    await http.request({ method: 'POST', path: '/x', body: { a: 1 }, schema });
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe('{"a":1}');
  });

  it('espaça chamadas em minIntervalMs', async () => {
    const { http, fetchMock, sleeps, starts } = setup([
      json({ id: 1 }),
      json({ id: 2 }),
      json({ id: 3 }),
    ]);
    const results = await Promise.all([
      http.request({ method: 'GET', path: '/a', schema }),
      http.request({ method: 'GET', path: '/b', schema }),
      http.request({ method: 'GET', path: '/c', schema }),
    ]);
    expect(results.map(r => r.id)).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual([
      'https://api.test/v1/a',
      'https://api.test/v1/b',
      'https://api.test/v1/c',
    ]);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(2000);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1000);
  });

  it('repete GET em 429 e 503 e devolve o sucesso', async () => {
    const { http, fetchMock } = setup([
      json({ message: 'slow' }, 429),
      json({ message: 'down' }, 503),
      json({ id: 7 }),
    ]);
    const result = await http.request({ method: 'GET', path: '/x', schema });
    expect(result).toEqual({ id: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('desiste após maxRetries', async () => {
    const { http, fetchMock } = setup(
      [json({}, 503), json({}, 503), json({}, 503), json({}, 503)],
      { maxRetries: 2 },
    );
    await expect(http.request({ method: 'GET', path: '/x', schema })).rejects.toBeInstanceOf(
      RevgasUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('não repete GET em 400/403/404/422', async () => {
    for (const status of [400, 403, 404, 422]) {
      const { http, fetchMock } = setup([json({ message: 'no' }, status), json({ id: 1 })]);
      await expect(http.request({ method: 'GET', path: '/x', schema })).rejects.toBeDefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('mapeia erros HTTP não repetíveis', async () => {
    const a = setup([json({ message: 'nf' }, 404)]);
    await expect(a.http.request({ method: 'GET', path: '/x', schema })).rejects.toBeInstanceOf(
      RevgasNotFoundError,
    );
    const b = setup([json({ message: 'bad', data: [] }, 422)]);
    await expect(
      b.http.request({ method: 'POST', path: '/x', body: {}, schema }),
    ).rejects.toBeInstanceOf(RevgasValidationError);
  });

  it('nunca repete POST em 503', async () => {
    const { http, fetchMock } = setup([json({}, 503), json({ id: 1 })]);
    await expect(
      http.request({ method: 'POST', path: '/x', body: {}, schema }),
    ).rejects.toBeInstanceOf(RevgasUnknownOutcomeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('POST com timeout lança RevgasUnknownOutcomeError', async () => {
    const { http, fetchMock } = setup([timeout(), json({ id: 1 })]);
    await expect(
      http.request({ method: 'POST', path: '/x', body: {}, schema }),
    ).rejects.toBeInstanceOf(RevgasUnknownOutcomeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('POST com erro de rede lança RevgasUnknownOutcomeError', async () => {
    const { http, fetchMock } = setup([new TypeError('fetch failed'), json({ id: 1 })]);
    await expect(
      http.request({ method: 'POST', path: '/x', body: {}, schema }),
    ).rejects.toBeInstanceOf(RevgasUnknownOutcomeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('PUT com erro de rede lança RevgasUnknownOutcomeError', async () => {
    const { http, fetchMock } = setup([new TypeError('fetch failed'), json({ id: 1 })]);
    await expect(
      http.request({ method: 'PUT', path: '/x', body: {}, schema }),
    ).rejects.toBeInstanceOf(RevgasUnknownOutcomeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('POST com 500 ou 504 lança RevgasUnknownOutcomeError sem repetir', async () => {
    for (const status of [500, 504]) {
      const { http, fetchMock } = setup([
        json({ message: 'segredo-do-corpo' }, status),
        json({ id: 1 }),
      ]);
      const error = await http
        .request({ method: 'POST', path: '/x', body: {}, schema })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RevgasUnknownOutcomeError);
      expect((error as Error).message).not.toContain('segredo-do-corpo');
      expect((error as Error).message).not.toContain(API_KEY);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('PUT com 502 lança RevgasUnknownOutcomeError', async () => {
    const { http, fetchMock } = setup([json({}, 502)]);
    await expect(
      http.request({ method: 'PUT', path: '/x', body: {}, schema }),
    ).rejects.toBeInstanceOf(RevgasUnknownOutcomeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('POST com 429 lança RevgasUnavailableError sem repetir', async () => {
    const { http, fetchMock } = setup([json({ message: 'slow' }, 429), json({ id: 1 })]);
    await expect(
      http.request({ method: 'POST', path: '/x', body: {}, schema }),
    ).rejects.toBeInstanceOf(RevgasUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('corpo não serializável lança o erro original sem chamar fetch', async () => {
    const { http, fetchMock } = setup([json({ id: 1 })]);
    await expect(
      http.request({ method: 'POST', path: '/x', body: { n: BigInt(1) }, schema }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET com erro de rede repete', async () => {
    const { http, fetchMock } = setup([new TypeError('fetch failed'), json({ id: 3 })]);
    await expect(http.request({ method: 'GET', path: '/x', schema })).resolves.toEqual({ id: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('GET com timeout esgotado lança RevgasUnavailableError', async () => {
    const { http, fetchMock } = setup([timeout(), timeout()], { maxRetries: 1 });
    await expect(http.request({ method: 'GET', path: '/x', schema })).rejects.toBeInstanceOf(
      RevgasUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resposta fora do schema lança RevgasResponseError sem o valor recebido', async () => {
    const { http } = setup([json({ id: 'valor-sensivel-xyz' })]);
    const error = await http
      .request({ method: 'GET', path: '/x', schema })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RevgasResponseError);
    const e = error as RevgasResponseError;
    expect(e.issues[0].path).toBe('id');
    expect(e.message).not.toContain('valor-sensivel-xyz');
    expect(JSON.stringify(e.issues)).not.toContain('valor-sensivel-xyz');
  });

  it('resposta que não é JSON em sucesso lança RevgasResponseError', async () => {
    const { http } = setup([new Response('<html>', { status: 200 })]);
    await expect(http.request({ method: 'GET', path: '/x', schema })).rejects.toBeInstanceOf(
      RevgasResponseError,
    );
  });

  it('loga método, rota, status, duração e tentativa', async () => {
    const { http, logger } = setup([json({}, 503), json({ id: 1 })]);
    await http.request({ method: 'GET', path: '/x', query: { page: 1 }, schema });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'revgas',
        method: 'GET',
        path: '/x',
        query: { page: 1 },
        status: 503,
        attempt: 1,
        durationMs: expect.any(Number),
      }),
      expect.any(String),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200, attempt: 2, durationMs: expect.any(Number) }),
      expect.any(String),
    );
  });

  it('não loga a chave nem o telefone cru', async () => {
    const { http, logger } = setup([new TypeError('fetch failed'), json({ id: 1 })]);
    await http.request({
      method: 'GET',
      path: '/customers',
      query: { phone: '5586999998888' },
      schema,
    });
    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain(API_KEY);
    expect(logged).not.toContain('5586999998888');
    expect(logged).toContain('8888');
  });
});
