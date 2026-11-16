import { describe, expect, it, vi } from 'vitest';
import {
  LlmRateLimitedError,
  LlmResponseError,
  LlmUnavailableError,
} from '../../core/erros/llm/llm.errors';
import { OpenAiCompatibleEmbeddingClient } from './openai-compatible-embedding.client';

const API_KEY = 'AIza-chave-secreta';

const embeddings = (vectors: number[][], extra: object = {}) => ({
  model: 'modelo-emb',
  data: vectors.map((embedding, index) => ({ index, embedding })),
  usage: { prompt_tokens: 7, total_tokens: 7 },
  ...extra,
});

function setup(
  responses: Array<{ body: unknown; status?: number } | Error>,
  options: { dimensions?: number; batchSize?: number } = {},
) {
  const queue = [...responses];
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift() ?? { body: {} };
    if (next instanceof Error) {
      throw next;
    }
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  });
  const logger = { info: vi.fn(), warn: vi.fn() };
  const client = new OpenAiCompatibleEmbeddingClient({
    baseUrl: 'https://emb.test/',
    apiKey: API_KEY,
    model: 'modelo-emb',
    dimensions: options.dimensions ?? 4,
    batchSize: options.batchSize ?? 16,
    timeoutMs: 1000,
    logger,
    fetch: fetchMock as unknown as typeof fetch,
  });
  const call = (index = 0) => {
    const [url, init] = fetchMock.mock.calls[index];
    return {
      url: String(url),
      init: init as RequestInit,
      body: JSON.parse(String(init?.body)),
    };
  };
  return { client, fetchMock, logger, call };
}

const request = (input: string[]) => ({ operation: 'kb_query', input });

describe('OpenAiCompatibleEmbeddingClient', () => {
  it('envia POST {baseUrl}/embeddings com Bearer, model, input e dimensions', async () => {
    const { client, call } = setup([
      {
        body: embeddings([
          [1, 0, 0, 0],
          [0, 1, 0, 0],
        ]),
      },
    ]);

    await client.embed(request(['a', 'b']));

    const { url, init, body } = call();
    expect(url).toBe('https://emb.test/embeddings');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    expect(body).toEqual({ model: 'modelo-emb', input: ['a', 'b'], dimensions: 4 });
  });

  it('expõe model e dimensions', () => {
    const { client } = setup([]);
    expect(client.model).toBe('modelo-emb');
    expect(client.dimensions).toBe(4);
  });

  it('ordena pelos index da resposta', async () => {
    const { client } = setup([
      {
        body: {
          data: [
            { index: 1, embedding: [0, 1, 0, 0] },
            { index: 0, embedding: [1, 0, 0, 0] },
          ],
        },
      },
    ]);

    const result = await client.embed(request(['a', 'b']));

    expect(result.vectors).toEqual([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ]);
  });

  it('normaliza os vetores', async () => {
    const { client } = setup([{ body: embeddings([[3, 4, 0, 0]]) }]);

    const result = await client.embed(request(['a']));

    expect(result.vectors[0][0]).toBeCloseTo(0.6, 6);
    expect(result.vectors[0][1]).toBeCloseTo(0.8, 6);
    expect(result.vectors[0][2]).toBe(0);
  });

  it('vetor maior que a dimensão é cortado e renormalizado', async () => {
    const { client } = setup([{ body: embeddings([[3, 4, 12]]) }], { dimensions: 2 });

    const result = await client.embed(request(['a']));

    expect(result.vectors[0]).toHaveLength(2);
    expect(result.vectors[0][0]).toBeCloseTo(0.6, 6);
    expect(result.vectors[0][1]).toBeCloseTo(0.8, 6);
  });

  it('vetor menor que a dimensão → LlmResponseError', async () => {
    const { client } = setup([{ body: embeddings([[1, 0]]) }]);

    await expect(client.embed(request(['a']))).rejects.toBeInstanceOf(LlmResponseError);
  });

  it('quantidade de vetores diferente da de textos → LlmResponseError', async () => {
    const { client } = setup([{ body: embeddings([[1, 0, 0, 0]]) }]);

    await expect(client.embed(request(['a', 'b']))).rejects.toBeInstanceOf(LlmResponseError);
  });

  it('vetor todo zero → LlmResponseError', async () => {
    const { client } = setup([{ body: embeddings([[0, 0, 0, 0]]) }]);

    await expect(client.embed(request(['a']))).rejects.toBeInstanceOf(LlmResponseError);
  });

  it('lote: batchSize 2 com 5 textos → 3 POSTs em sequência, vetores na ordem dos textos', async () => {
    const unit = (i: number) => [0, 0, 0, 0].map((_, p) => (p === i ? 1 : 0));
    const { client, fetchMock, call } = setup(
      [
        { body: embeddings([unit(0), unit(1)]) },
        { body: embeddings([unit(2), unit(3)]) },
        { body: embeddings([unit(0)]) },
      ],
      { batchSize: 2 },
    );

    const result = await client.embed(request(['a', 'b', 'c', 'd', 'e']));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(call(0).body.input).toEqual(['a', 'b']);
    expect(call(1).body.input).toEqual(['c', 'd']);
    expect(call(2).body.input).toEqual(['e']);
    expect(result.vectors).toEqual([unit(0), unit(1), unit(2), unit(3), unit(0)]);
    expect(result.usage.inputTokens).toBe(21);
  });

  it('input vazio → [] sem chamar fetch', async () => {
    const { client, fetchMock } = setup([]);

    const result = await client.embed(request([]));

    expect(result.vectors).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('429 → LlmRateLimitedError', async () => {
    const { client } = setup([{ status: 429, body: { error: { message: 'cota', code: 429 } } }]);

    await expect(client.embed(request(['a']))).rejects.toBeInstanceOf(LlmRateLimitedError);
  });

  it('timeout → LlmUnavailableError', async () => {
    const timeout = new DOMException('The operation timed out', 'TimeoutError');
    const { client } = setup([timeout]);

    await expect(client.embed(request(['a']))).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('envelope inválido → LlmResponseError', async () => {
    const { client } = setup([{ body: { foo: 'bar' } }]);

    await expect(client.embed(request(['a']))).rejects.toBeInstanceOf(LlmResponseError);
  });

  it('log de sucesso leva operation, model, status, durationMs, inputTokens e inputs, nunca o texto', async () => {
    const { client, logger } = setup([{ body: embeddings([[1, 0, 0, 0]]) }]);

    await client.embed(request(['Moro na Rua das Flores 123']));

    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0][0]).toMatchObject({
      component: 'llm',
      operation: 'kb_query',
      model: 'modelo-emb',
      status: 200,
      inputTokens: 7,
      inputs: 1,
    });
    expect(logger.info.mock.calls[0][0]).toHaveProperty('durationMs');
    const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls]);
    expect(logged).not.toContain('Rua das Flores');
    expect(logged).not.toContain(API_KEY);
  });

  it('falhas logam warn sem texto nem chave', async () => {
    const { client, logger } = setup([
      { status: 429, body: { error: { message: 'Rua das Flores' } } },
    ]);

    await client.embed(request(['Rua das Flores'])).catch(() => undefined);

    expect(logger.warn).toHaveBeenCalledOnce();
    const logged = JSON.stringify(logger.warn.mock.calls);
    expect(logged).toContain('rate_limited');
    expect(logged).not.toContain('Rua das Flores');
    expect(logged).not.toContain(API_KEY);
  });
});
