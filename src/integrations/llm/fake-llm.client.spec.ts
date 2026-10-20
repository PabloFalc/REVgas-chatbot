import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  LlmInvalidOutputError,
  LlmRateLimitedError,
  LlmUnavailableError,
} from '../../core/erros/llm/llm.errors';
import { FakeLlmClient } from './fake-llm.client';
import type { LlmMessage } from './llm.schemas';

const messages: LlmMessage[] = [{ role: 'user', content: 'oi' }];
const schema = z.object({ quantidade: z.number().int() });

describe('FakeLlmClient', () => {
  it('sem resposta programada → LlmUnavailableError', async () => {
    const client = new FakeLlmClient();
    await expect(client.generateText({ operation: 'op', messages })).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
  });

  it('devolve respostas da fila em ordem e registra calls (operation, messages, schemaName)', async () => {
    const client = new FakeLlmClient();
    client.queueText('primeira');
    client.queueObject({ quantidade: 2 });

    const text = await client.generateText({ operation: 'texto', messages });
    const object = await client.generateObject({
      operation: 'objeto',
      messages,
      schema,
      schemaName: 'Pedido',
    });

    expect(text).toEqual({ text: 'primeira', model: 'fake', usage: {}, durationMs: 0 });
    expect(object).toEqual({ object: { quantidade: 2 }, model: 'fake', usage: {}, durationMs: 0 });
    expect(client.calls).toEqual([
      { operation: 'texto', messages },
      { operation: 'objeto', messages, schemaName: 'Pedido' },
    ]);
  });

  it('queueError lança o erro programado', async () => {
    const client = new FakeLlmClient();
    client.queueError(new LlmRateLimitedError('limite', 429));
    await expect(client.generateText({ operation: 'op', messages })).rejects.toBeInstanceOf(
      LlmRateLimitedError,
    );
    expect(client.calls).toHaveLength(1);
  });

  it('respondWith é usado quando a fila está vazia', async () => {
    const client = new FakeLlmClient();
    client.queueText('da fila');
    client.respondWith(request => ({ text: `eco ${request.operation}` }));

    expect((await client.generateText({ operation: 'a', messages })).text).toBe('da fila');
    expect((await client.generateText({ operation: 'b', messages })).text).toBe('eco b');
  });

  it('respondWith pode devolver um LlmError', async () => {
    const client = new FakeLlmClient();
    client.respondWith(() => new LlmUnavailableError('fora'));
    await expect(client.generateText({ operation: 'op', messages })).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
  });

  it('generateObject valida o objeto programado com o schema de quem chama', async () => {
    const client = new FakeLlmClient();
    client.queueObject({ quantidade: 'duas' });
    await expect(
      client.generateObject({ operation: 'op', messages, schema, schemaName: 'Pedido' }),
    ).rejects.toBeInstanceOf(LlmInvalidOutputError);
  });

  it('generateObject aceita { text } com JSON e generateText aceita { object } (JSON.stringify)', async () => {
    const client = new FakeLlmClient();
    client.queueText('```json\n{"quantidade":4}\n```');
    client.queueObject({ quantidade: 5 });

    const object = await client.generateObject({
      operation: 'op',
      messages,
      schema,
      schemaName: 'Pedido',
    });
    const text = await client.generateText({ operation: 'op', messages });

    expect(object.object).toEqual({ quantidade: 4 });
    expect(text.text).toBe('{"quantidade":5}');
  });

  it('clear esvazia fila, handler e calls', async () => {
    const client = new FakeLlmClient();
    client.queueText('x');
    client.respondWith(() => ({ text: 'y' }));
    await client.generateText({ operation: 'op', messages });

    client.clear();

    expect(client.calls).toEqual([]);
    await expect(client.generateText({ operation: 'op', messages })).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
  });
});
