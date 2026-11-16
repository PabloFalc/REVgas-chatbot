import { describe, expect, it } from 'vitest';
import { type Env, envConfigSchema } from '../../../config/env';
import { resolveEmbeddingConfig } from './embedding.config';

const base = { DATABASE_URL: 'postgresql://docker:docker@localhost:5432/revgas' };

const parse = (extra: Record<string, unknown> = {}): Env =>
  envConfigSchema.parse({ ...base, ...extra });

describe('resolveEmbeddingConfig', () => {
  it('sem chave nenhuma → fake', () => {
    expect(resolveEmbeddingConfig(parse()).mode).toBe('fake');
  });

  it('EMBEDDING_API_KEY sem LLM_API_KEY → live com a chave de embedding', () => {
    const config = resolveEmbeddingConfig(parse({ EMBEDDING_API_KEY: 'chave-emb' }));
    expect(config.mode).toBe('live');
    expect(config.apiKey).toBe('chave-emb');
  });

  it('só LLM_API_KEY → live e reaproveita a chave e a URL do chat', () => {
    const config = resolveEmbeddingConfig(
      parse({ LLM_API_KEY: 'chave-chat', LLM_API_URL: 'https://chat.test/v1' }),
    );
    expect(config.mode).toBe('live');
    expect(config.apiKey).toBe('chave-chat');
    expect(config.baseUrl).toBe('https://chat.test/v1');
  });

  it('EMBEDDING_API_URL sobrescreve a URL e tira a barra final', () => {
    const config = resolveEmbeddingConfig(
      parse({ LLM_API_URL: 'https://chat.test/v1', EMBEDDING_API_URL: 'https://emb.test/v1/' }),
    );
    expect(config.baseUrl).toBe('https://emb.test/v1');
  });

  it('LLM_MODE=live sem chave → lança', () => {
    expect(() => resolveEmbeddingConfig(parse({ LLM_MODE: 'live' }))).toThrow(
      'EMBEDDING_API_KEY ou LLM_API_KEY obrigatório com LLM_MODE=live',
    );
  });

  it('LLM_MODE=fake vale mesmo com chave', () => {
    expect(resolveEmbeddingConfig(parse({ LLM_API_KEY: 'x', LLM_MODE: 'fake' })).mode).toBe('fake');
  });

  it('defaults: model, dimensions, batchSize e timeoutMs = LLM_TIMEOUT_MS', () => {
    const config = resolveEmbeddingConfig(parse({ LLM_TIMEOUT_MS: '5000' }));
    expect(config).toMatchObject({
      model: 'gemini-embedding-001',
      dimensions: 768,
      batchSize: 16,
      timeoutMs: 5000,
    });
  });

  it('respeita model, dimensions e batchSize customizados', () => {
    const config = resolveEmbeddingConfig(
      parse({ EMBEDDING_MODEL: 'outro', EMBEDDING_DIMENSIONS: '256', EMBEDDING_BATCH_SIZE: '4' }),
    );
    expect(config).toMatchObject({ model: 'outro', dimensions: 256, batchSize: 4 });
  });
});
