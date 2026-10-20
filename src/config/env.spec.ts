import { describe, expect, it } from 'vitest';
import { envConfigSchema } from './env';

const base = { DATABASE_URL: 'postgresql://docker:docker@localhost:5432/revgas' };

describe('envConfigSchema', () => {
  it('REVGAS_API_URL vazio usa o default; demais opcionais vazias ficam não definidas', () => {
    const env = envConfigSchema.parse({
      ...base,
      CORS_ORIGIN: '',
      TRUSTED_PROXY: '',
      DOC_TOKEN: '',
      REDIS_PASSWORD: '',
      BETTER_AUTH_SECRET: '',
      REVGAS_API_URL: '',
      REVGAS_MODE: '',
      REVGAS_ESTABLISHMENT_ID: '',
      RESEND_API_KEY: '',
      EMAIL_DEV_REDIRECT: '',
    });

    expect(env.CORS_ORIGIN).toBeUndefined();
    expect(env.TRUSTED_PROXY).toBeUndefined();
    expect(env.DOC_TOKEN).toBeUndefined();
    expect(env.REDIS_PASSWORD).toBeUndefined();
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(env.REVGAS_API_URL).toBe('https://api.revgas.com/v1');
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

  it('recusa REVGAS_MODE inválido', () => {
    const result = envConfigSchema.safeParse({ ...base, REVGAS_MODE: 'turbo' });
    expect(result.success).toBe(false);
  });

  it('coage REVGAS_ESTABLISHMENT_ID para número', () => {
    const env = envConfigSchema.parse({ ...base, REVGAS_ESTABLISHMENT_ID: '42' });
    expect(env.REVGAS_ESTABLISHMENT_ID).toBe(42);
  });
});
