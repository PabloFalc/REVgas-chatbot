import { describe, expect, it } from 'vitest';
import { type Env, envConfigSchema } from '../../../config/env';
import { resolveViacepConfig } from './viacep.config';

const base = { DATABASE_URL: 'postgresql://docker:docker@localhost:5432/revgas' };

const parse = (extra: Record<string, unknown> = {}): Env =>
  envConfigSchema.parse({ ...base, ...extra });

describe('resolveViacepConfig', () => {
  it('usa live fora de test, com os padrões', () => {
    expect(resolveViacepConfig(parse({ NODE_ENV: 'development' }))).toEqual({
      mode: 'live',
      baseUrl: 'https://viacep.com.br/ws',
      timeoutMs: 5000,
    });
  });

  it('usa fake em test', () => {
    expect(resolveViacepConfig(parse({ NODE_ENV: 'test' })).mode).toBe('fake');
  });

  it('respeita VIACEP_MODE e remove a barra final da URL', () => {
    const config = resolveViacepConfig(
      parse({ NODE_ENV: 'test', VIACEP_MODE: 'live', VIACEP_API_URL: 'https://x.test/ws/' }),
    );
    expect(config.mode).toBe('live');
    expect(config.baseUrl).toBe('https://x.test/ws');
  });
});
