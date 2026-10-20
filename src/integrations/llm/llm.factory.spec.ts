import { describe, expect, it, vi } from 'vitest';
import { FakeLlmClient } from './fake-llm.client';
import { createLlmClient } from './llm.factory';
import { OpenAiCompatibleLlmClient } from './openai-compatible-llm.client';
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
