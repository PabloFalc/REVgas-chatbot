import { describe, expect, it, vi } from 'vitest';
import { FakeEmbeddingClient } from './fake-embedding.client';
import { FakeLlmClient } from './fake-llm.client';
import { createEmbeddingClient, createLlmClient } from './llm.factory';
import { OpenAiCompatibleEmbeddingClient } from './openai-compatible-embedding.client';
import { OpenAiCompatibleLlmClient } from './openai-compatible-llm.client';
import type { EmbeddingConfig } from './shared/embedding.config';
import type { LlmConfig } from './shared/llm.config';

const config = (overrides: Partial<LlmConfig> = {}): LlmConfig => ({
  mode: 'fake',
  baseUrl: 'https://llm.test/v1',
  apiKey: 'chave-de-teste',
  model: 'modelo-de-teste',
  timeoutMs: 1000,
  ...overrides,
});

const logger = () => ({ info: vi.fn(), warn: vi.fn() });

describe('createLlmClient', () => {
  it('mode fake → FakeLlmClient', () => {
    expect(createLlmClient(config())).toBeInstanceOf(FakeLlmClient);
  });

  it('mode live → OpenAiCompatibleLlmClient', () => {
    expect(createLlmClient(config({ mode: 'live' }))).toBeInstanceOf(OpenAiCompatibleLlmClient);
  });

  it('fake em produção loga um aviso', () => {
    const log = logger();
    createLlmClient(config(), { logger: log, nodeEnv: 'production' });
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('fake fora de produção não avisa', () => {
    const log = logger();
    createLlmClient(config(), { logger: log, nodeEnv: 'development' });
    expect(log.warn).not.toHaveBeenCalled();
  });
});

const embeddingConfig = (overrides: Partial<EmbeddingConfig> = {}): EmbeddingConfig => ({
  mode: 'fake',
  baseUrl: 'https://llm.test/v1',
  apiKey: 'chave-de-teste',
  model: 'modelo-emb',
  dimensions: 768,
  batchSize: 16,
  timeoutMs: 1000,
  ...overrides,
});

describe('createEmbeddingClient', () => {
  it('mode fake → FakeEmbeddingClient com model e dimensions da config', () => {
    const client = createEmbeddingClient(embeddingConfig({ dimensions: 64, model: 'm' }));
    expect(client).toBeInstanceOf(FakeEmbeddingClient);
    expect(client.dimensions).toBe(64);
    expect(client.model).toBe('m');
  });

  it('mode live → OpenAiCompatibleEmbeddingClient', () => {
    const client = createEmbeddingClient(embeddingConfig({ mode: 'live' }));
    expect(client).toBeInstanceOf(OpenAiCompatibleEmbeddingClient);
    expect(client.model).toBe('modelo-emb');
    expect(client.dimensions).toBe(768);
  });

  it('fake em produção loga um aviso', () => {
    const log = logger();
    createEmbeddingClient(embeddingConfig(), { logger: log, nodeEnv: 'production' });
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('fake fora de produção não avisa', () => {
    const log = logger();
    createEmbeddingClient(embeddingConfig(), { logger: log, nodeEnv: 'development' });
    expect(log.warn).not.toHaveBeenCalled();
  });
});
