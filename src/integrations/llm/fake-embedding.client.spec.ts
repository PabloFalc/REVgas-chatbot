import { describe, expect, it } from 'vitest';
import { LlmRateLimitedError } from '../../core/erros/llm/llm.errors';
import { FakeEmbeddingClient } from './fake-embedding.client';

const norm = (v: number[]) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
const cosine = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);

describe('FakeEmbeddingClient', () => {
  it('mesmo texto → mesmo vetor, mesmo em instâncias diferentes', () => {
    const a = new FakeEmbeddingClient().vectorFor('entrega no bairro Jóquei');
    const b = new FakeEmbeddingClient().vectorFor('entrega no bairro Jóquei');
    expect(a).toEqual(b);
  });

  it('vetor tem 768 posições e norma 1', () => {
    const vector = new FakeEmbeddingClient().vectorFor('botijão de gás');
    expect(vector).toHaveLength(768);
    expect(norm(vector)).toBeCloseTo(1, 6);
  });

  it('respeita dimensions e model customizados', () => {
    const client = new FakeEmbeddingClient({ dimensions: 32, model: 'x' });
    expect(client.dimensions).toBe(32);
    expect(client.model).toBe('x');
    expect(client.vectorFor('gás')).toHaveLength(32);
  });

  it('acento e caixa não mudam o vetor', () => {
    const client = new FakeEmbeddingClient();
    expect(client.vectorFor('Vale-Gás')).toEqual(client.vectorFor('vale gas'));
  });

  it('palavras em comum aumentam o cosseno', () => {
    const client = new FakeEmbeddingClient();
    const query = client.vectorFor('entrega no bairro Jóquei');
    const near = client.vectorFor('bairros atendidos Jóquei');
    const far = client.vectorFor('preço da carne');
    expect(cosine(query, near)).toBeGreaterThan(cosine(query, far));
  });

  it('texto sem palavra → vetor unitário fixo', () => {
    const client = new FakeEmbeddingClient();
    expect(client.vectorFor('?!')).toEqual(client.vectorFor(''));
    expect(norm(client.vectorFor(''))).toBeCloseTo(1, 6);
  });

  it('embed responde sem programação e registra calls', async () => {
    const client = new FakeEmbeddingClient();
    const result = await client.embed({ operation: 'kb_query', input: ['a', 'b'] });
    expect(result.vectors).toEqual([client.vectorFor('a'), client.vectorFor('b')]);
    expect(result).toMatchObject({ model: 'fake', usage: {}, durationMs: 0 });
    expect(client.calls).toEqual([{ operation: 'kb_query', input: ['a', 'b'] }]);
  });

  it('queueError lança na próxima chamada e depois volta a responder', async () => {
    const client = new FakeEmbeddingClient();
    client.queueError(new LlmRateLimitedError('limite'));
    await expect(client.embed({ operation: 'op', input: ['a'] })).rejects.toBeInstanceOf(
      LlmRateLimitedError,
    );
    await expect(client.embed({ operation: 'op', input: ['a'] })).resolves.toBeDefined();
    expect(client.calls).toHaveLength(2);
  });

  it('clear zera calls e erros enfileirados', async () => {
    const client = new FakeEmbeddingClient();
    client.queueError(new LlmRateLimitedError('limite'));
    await client.embed({ operation: 'op', input: ['a'] }).catch(() => undefined);
    client.queueError(new LlmRateLimitedError('limite'));
    client.clear();
    expect(client.calls).toHaveLength(0);
    await expect(client.embed({ operation: 'op', input: ['a'] })).resolves.toBeDefined();
  });
});
