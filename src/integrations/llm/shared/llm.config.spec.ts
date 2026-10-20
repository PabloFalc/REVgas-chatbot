import { describe, expect, it } from 'vitest';
import { type Env, envConfigSchema } from '../../../config/env';
import { resolveLlmConfig } from './llm.config';

const base = { DATABASE_URL: 'postgresql://docker:docker@localhost:5432/revgas' };

const parse = (extra: Record<string, unknown> = {}): Env =>
  envConfigSchema.parse({ ...base, ...extra });

const key = 'chave-de-teste-gemini';

describe('resolveLlmConfig', () => {
  it('usa fake sem chave, com os padrões', () => {
    expect(resolveLlmConfig(parse())).toEqual({
      mode: 'fake',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: undefined,
      model: 'gemini-3.8-flash',
      timeoutMs: 8000,
    });
  });

  it('usa live quando há LLM_API_KEY e LLM_MODE não foi definido', () => {
    const config = resolveLlmConfig(parse({ LLM_API_KEY: key }));
    expect(config.mode).toBe('live');
    expect(config.apiKey).toBe(key);
  });

  it('respeita LLM_MODE=fake mesmo com chave', () => {
    expect(resolveLlmConfig(parse({ LLM_API_KEY: key, LLM_MODE: 'fake' })).mode).toBe('fake');
  });

  it('falha com LLM_MODE=live sem chave', () => {
    expect(() => resolveLlmConfig(parse({ LLM_MODE: 'live' }))).toThrow('LLM_API_KEY');
  });

  it('trata string vazia como ausente', () => {
    const config = resolveLlmConfig(
      parse({ LLM_API_KEY: '', LLM_MODEL: '', LLM_API_URL: '', LLM_TIMEOUT_MS: '', LLM_MODE: '' }),
    );
    expect(config.model).toBe('gemini-3.8-flash');
    expect(config.mode).toBe('fake');
    expect(config.timeoutMs).toBe(8000);
  });

  it('remove barra final da URL base', () => {
    const config = resolveLlmConfig(parse({ LLM_API_URL: 'https://llm.exemplo.com/v1/' }));
    expect(config.baseUrl).toBe('https://llm.exemplo.com/v1');
  });

  it('aceita timeout customizado e recusa valores inválidos', () => {
    expect(resolveLlmConfig(parse({ LLM_TIMEOUT_MS: '3000' })).timeoutMs).toBe(3000);
    expect(envConfigSchema.safeParse({ ...base, LLM_TIMEOUT_MS: '0' }).success).toBe(false);
    expect(envConfigSchema.safeParse({ ...base, LLM_API_URL: 'nao-e-url' }).success).toBe(false);
  });
});
