import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  LlmInvalidOutputError,
  LlmRateLimitedError,
  LlmRejectedError,
  LlmResponseError,
  LlmUnauthorizedError,
  LlmUnavailableError,
} from '../../core/erros/llm/llm.errors';
import type { LlmObjectRequest, LlmTextRequest } from './llm.schemas';
import { OpenAiCompatibleLlmClient } from './openai-compatible-llm.client';
import { completion, providerError } from './testing/llm.testing';

const API_KEY = 'AIza-chave-secreta';

const textRequest: LlmTextRequest = {
  operation: 'faq',
  messages: [
    { role: 'system', content: 'Responda curto' },
    { role: 'user', content: 'Moro na Rua das Flores 123' },
  ],
};

const orderSchema = z.object({ quantidade: z.number(), produto: z.string() });

const objectRequest: LlmObjectRequest<z.infer<typeof orderSchema>> = {
  ...textRequest,
  operation: 'extract_order',
  schema: orderSchema,
  schemaName: 'pedido',
};

function setup(responses: Array<{ body: unknown; status?: number } | Error>) {
  const queue = [...responses];
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift() ?? { body: {} };
    if (next instanceof Error) {
      throw next;
    }
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  });
  const logger = { info: vi.fn(), warn: vi.fn() };
  const client = new OpenAiCompatibleLlmClient({
    baseUrl: 'https://llm.test/',
    apiKey: API_KEY,
    model: 'gemini-test',
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

describe('OpenAiCompatibleLlmClient', () => {
  it('generateText: POST /chat/completions com Bearer, modelo e mensagens', async () => {
    const { client, call } = setup([{ body: completion('Abrimos às 7h') }]);

    await expect(client.generateText(textRequest)).resolves.toMatchObject({
      text: 'Abrimos às 7h',
      model: 'gemini-test',
    });

    const { url, init, body } = call();
    expect(url).toBe('https://llm.test/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(body).toMatchObject({ model: 'gemini-test', messages: textRequest.messages });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('response_format');
  });

  it('generateObject: envia response_format json_schema com strict e sem $schema', async () => {
    const { client, call } = setup([
      { body: completion(JSON.stringify({ quantidade: 2, produto: 'P13' })) },
    ]);

    await client.generateObject(objectRequest);

    const { response_format } = call().body;
    expect(response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'pedido', strict: true },
    });
    expect(response_format.json_schema.schema).not.toHaveProperty('$schema');
    expect(response_format.json_schema.schema.properties).toHaveProperty('quantidade');
  });

  it('generateObject: devolve o objeto validado', async () => {
    const { client } = setup([
      { body: completion(JSON.stringify({ quantidade: 2, produto: 'P13' })) },
    ]);

    await expect(client.generateObject(objectRequest)).resolves.toMatchObject({
      object: { quantidade: 2, produto: 'P13' },
      model: 'gemini-test',
    });
  });

  it('generateObject: objeto fora do schema -> LlmInvalidOutputError', async () => {
    const { client, logger } = setup([{ body: completion(JSON.stringify({ quantidade: 'x' })) }]);

    await expect(client.generateObject(objectRequest)).rejects.toBeInstanceOf(
      LlmInvalidOutputError,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'extract_order', error: 'invalid_output' }),
      'llm request failed',
    );
  });

  it('repassa temperature, maxOutputTokens (max_tokens) e timeoutMs por chamada', async () => {
    const { client, call } = setup([{ body: completion('ok') }]);
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await client.generateText({
      ...textRequest,
      temperature: 0.2,
      maxOutputTokens: 100,
      timeoutMs: 3000,
    });

    expect(call().body).toMatchObject({ temperature: 0.2, max_tokens: 100 });
    expect(timeout).toHaveBeenCalledWith(3000);
    timeout.mockRestore();
  });

  it('mapeia usage para inputTokens/outputTokens', async () => {
    const { client, logger } = setup([{ body: completion('ok') }]);

    const result = await client.generateText(textRequest);

    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'llm',
        operation: 'faq',
        model: 'gemini-test',
        status: 200,
        inputTokens: 12,
        outputTokens: 5,
      }),
      'llm request',
    );
  });

  it.each([
    [401, LlmUnauthorizedError],
    [429, LlmRateLimitedError],
    [400, LlmRejectedError],
    [503, LlmUnavailableError],
  ])('HTTP %i -> erro tipado', async (status, errorClass) => {
    const { client, fetchMock, logger } = setup([providerError(status, 'falhou')]);

    await expect(client.generateText(textRequest)).rejects.toBeInstanceOf(errorClass);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ status }),
      'llm request failed',
    );
  });

  it('timeout -> LlmUnavailableError, uma única chamada ao fetch', async () => {
    const timeoutError = new Error('timeout');
    timeoutError.name = 'TimeoutError';
    const { client, fetchMock, logger } = setup([timeoutError]);

    await expect(client.generateText(textRequest)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'timeout' }),
      'llm request failed',
    );
  });

  it('falha de rede -> LlmUnavailableError', async () => {
    const { client, logger } = setup([new TypeError('fetch failed')]);

    await expect(client.generateText(textRequest)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'network' }),
      'llm request failed',
    );
  });

  it('envelope sem choices -> LlmResponseError', async () => {
    const { client } = setup([{ body: { model: 'x', choices: [] } }]);

    await expect(client.generateText(textRequest)).rejects.toBeInstanceOf(LlmResponseError);
  });

  it('content nulo com finish_reason stop -> LlmResponseError', async () => {
    const { client } = setup([{ body: completion(null) }]);

    await expect(client.generateText(textRequest)).rejects.toBeInstanceOf(LlmResponseError);
  });

  it('finish_reason length -> LlmResponseError; content_filter -> LlmRejectedError', async () => {
    const { client } = setup([
      { body: completion('parcial', { finishReason: 'length' }) },
      { body: completion('x', { finishReason: 'content_filter' }) },
    ]);

    await expect(client.generateText(textRequest)).rejects.toBeInstanceOf(LlmResponseError);
    await expect(client.generateText(textRequest)).rejects.toBeInstanceOf(LlmRejectedError);
  });

  it('nenhum log contém a chave, as mensagens nem a resposta', async () => {
    const { client, logger } = setup([
      { body: completion('Abrimos às 7h') },
      providerError(400, 'Rua das Flores 123 inválida'),
      { body: completion('Abrimos às 7h', { finishReason: 'content_filter' }) },
    ]);

    await client.generateText(textRequest);
    await client.generateText(textRequest).catch(() => undefined);
    await client.generateText(textRequest).catch(() => undefined);

    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain(API_KEY);
    expect(logged).not.toContain('Rua das Flores 123');
    expect(logged).not.toContain('Abrimos às 7h');
  });
});
