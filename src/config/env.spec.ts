import { describe, expect, it } from 'vitest';
import { envConfigSchema } from './env';

const base = { DATABASE_URL: 'postgresql://docker:docker@localhost:5432/revgas' };

describe('envConfigSchema', () => {
  it('trata variáveis opcionais vazias como não definidas', () => {
    const env = envConfigSchema.parse({
      ...base,
      CORS_ORIGIN: '',
      TRUSTED_PROXY: '',
      DOC_TOKEN: '',
      REDIS_PASSWORD: '',
      BETTER_AUTH_SECRET: '',
      REVGAS_API_URL: '',
      RESEND_API_KEY: '',
      EMAIL_DEV_REDIRECT: '',
    });

    expect(env.CORS_ORIGIN).toBeUndefined();
    expect(env.TRUSTED_PROXY).toBeUndefined();
    expect(env.DOC_TOKEN).toBeUndefined();
    expect(env.REDIS_PASSWORD).toBeUndefined();
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(env.REVGAS_API_URL).toBeUndefined();
  });

  it('exige CORS_ORIGIN em produção', () => {
    const result = envConfigSchema.safeParse({ ...base, NODE_ENV: 'production', CORS_ORIGIN: '' });
    expect(result.success).toBe(false);
  });

  it('recusa "*" no CORS_ORIGIN em produção', () => {
    const result = envConfigSchema.safeParse({ ...base, NODE_ENV: 'production', CORS_ORIGIN: '*' });
    expect(result.success).toBe(false);
  });

  it('recusa BETTER_AUTH_SECRET curto quando definido', () => {
    const result = envConfigSchema.safeParse({ ...base, BETTER_AUTH_SECRET: 'curto' });
    expect(result.success).toBe(false);
  });
});
