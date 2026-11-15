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

  it('LOG_FILE é opcional e vazio fica não definido', () => {
    expect(envConfigSchema.parse({ ...base, LOG_FILE: '' }).LOG_FILE).toBeUndefined();
    expect(envConfigSchema.parse({ ...base, LOG_FILE: 'logs/chat.log' }).LOG_FILE).toBe(
      'logs/chat.log',
    );
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

  it('recusa EMBEDDING_BATCH_SIZE fora de 1..100 e EMBEDDING_DIMENSIONS inválido', () => {
    expect(envConfigSchema.safeParse({ ...base, EMBEDDING_BATCH_SIZE: '0' }).success).toBe(false);
    expect(envConfigSchema.safeParse({ ...base, EMBEDDING_BATCH_SIZE: '101' }).success).toBe(false);
    expect(envConfigSchema.safeParse({ ...base, EMBEDDING_DIMENSIONS: 'abc' }).success).toBe(false);
    expect(envConfigSchema.safeParse({ ...base, EMBEDDING_DIMENSIONS: '0' }).success).toBe(false);
  });

  it('limite de IA por telefone tem default 30 e recusa valor menor que 1', () => {
    expect(
      envConfigSchema.parse({ ...base, AI_CALLS_PER_PHONE_HOUR: '' }).AI_CALLS_PER_PHONE_HOUR,
    ).toBe(30);
    expect(
      envConfigSchema.parse({ ...base, AI_CALLS_PER_PHONE_HOUR: '5' }).AI_CALLS_PER_PHONE_HOUR,
    ).toBe(5);
    expect(envConfigSchema.safeParse({ ...base, AI_CALLS_PER_PHONE_HOUR: '0' }).success).toBe(
      false,
    );
  });

  it('aplica defaults da base de conhecimento e valida faixas', () => {
    const env = envConfigSchema.parse({ ...base, KNOWLEDGE_DIR: '', KNOWLEDGE_TOP_K: '' });
    expect(env.KNOWLEDGE_DIR).toBe('knowledge/base');
    expect(env.KNOWLEDGE_TOP_K).toBe(3);
    expect(env.KNOWLEDGE_MIN_SIMILARITY).toBe(0.7);
    expect(env.KNOWLEDGE_MIN_SIMILARITY_TEXT).toBe(0.6);
    expect(envConfigSchema.safeParse({ ...base, KNOWLEDGE_TOP_K: '0' }).success).toBe(false);
    expect(envConfigSchema.safeParse({ ...base, KNOWLEDGE_TOP_K: '11' }).success).toBe(false);
    expect(envConfigSchema.safeParse({ ...base, KNOWLEDGE_MIN_SIMILARITY: '1.5' }).success).toBe(
      false,
    );
    expect(
      envConfigSchema.safeParse({ ...base, KNOWLEDGE_MIN_SIMILARITY_TEXT: '-0.1' }).success,
    ).toBe(false);
  });

  it('EMBEDDING_* vazios usam os defaults', () => {
    const env = envConfigSchema.parse({
      ...base,
      EMBEDDING_API_URL: '',
      EMBEDDING_API_KEY: '',
      EMBEDDING_MODEL: '',
      EMBEDDING_DIMENSIONS: '',
      EMBEDDING_BATCH_SIZE: '',
    });
    expect(env.EMBEDDING_API_URL).toBeUndefined();
    expect(env.EMBEDDING_API_KEY).toBeUndefined();
    expect(env.EMBEDDING_MODEL).toBe('gemini-embedding-001');
    expect(env.EMBEDDING_DIMENSIONS).toBe(768);
    expect(env.EMBEDDING_BATCH_SIZE).toBe(16);
  });

  it('recusa SERVICE_HOURS inválido apontando o campo', () => {
    const result = envConfigSchema.safeParse({ ...base, SERVICE_HOURS: 'seg 18:00-08:00' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['SERVICE_HOURS']);
  });

  it('aceita SERVICE_HOURS válido', () => {
    const result = envConfigSchema.safeParse({ ...base, SERVICE_HOURS: 'seg-sex 08:00-18:00' });
    expect(result.success).toBe(true);
  });

  it('variáveis do Chatwoot: vazio vira indefinido e timeout tem default', () => {
    const env = envConfigSchema.parse({ ...base, CHATWOOT_MODE: '', CHATWOOT_API_TOKEN: '' });
    expect(env.CHATWOOT_MODE).toBeUndefined();
    expect(env.CHATWOOT_API_TOKEN).toBeUndefined();
    expect(env.CHATWOOT_TIMEOUT_MS).toBe(5000);
    expect(env.CHATWOOT_URL).toBe('http://localhost:3000');
  });
});
