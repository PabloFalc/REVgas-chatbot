import { describe, expect, it } from 'vitest';
import { type Env, envConfigSchema } from '../../../config/env';
import { resolveRevgasConfig } from './revgas.config';

const parse = (extra: Record<string, unknown> = {}): Env =>
  envConfigSchema.parse({
    DATABASE_URL: 'postgresql://docker:docker@localhost:5432/revgas',
    ...extra,
  });

describe('resolveRevgasConfig', () => {
  it('usa hybrid quando há chave e REVGAS_MODE não foi definido', () => {
    const config = resolveRevgasConfig(
      parse({ REVGAS_API_KEY: 'k', REVGAS_ESTABLISHMENT_ID: '1' }),
    );
    expect(config.mode).toBe('hybrid');
    expect(config.establishmentId).toBe(1);
  });

  it('usa fake quando não há chave', () => {
    const config = resolveRevgasConfig(parse());
    expect(config.mode).toBe('fake');
    expect(config.baseUrl).toBe('https://api.revgas.com/v1');
    expect(config.timeoutMs).toBe(10000);
    expect(config.minIntervalMs).toBe(1100);
  });

  it('respeita REVGAS_MODE explícito', () => {
    const config = resolveRevgasConfig(
      parse({ REVGAS_MODE: 'live', REVGAS_API_KEY: 'k', REVGAS_ESTABLISHMENT_ID: '2' }),
    );
    expect(config.mode).toBe('live');
    expect(config.apiKey).toBe('k');
  });

  it('falha em live/hybrid sem REVGAS_ESTABLISHMENT_ID', () => {
    expect(() => resolveRevgasConfig(parse({ REVGAS_MODE: 'live', REVGAS_API_KEY: 'k' }))).toThrow(
      /REVGAS_ESTABLISHMENT_ID/,
    );
    expect(() => resolveRevgasConfig(parse({ REVGAS_API_KEY: 'k' }))).toThrow(
      /REVGAS_ESTABLISHMENT_ID/,
    );
  });

  it('falha em live/hybrid sem REVGAS_API_KEY', () => {
    expect(() =>
      resolveRevgasConfig(parse({ REVGAS_MODE: 'hybrid', REVGAS_ESTABLISHMENT_ID: '1' })),
    ).toThrow(/REVGAS_API_KEY/);
  });
});
