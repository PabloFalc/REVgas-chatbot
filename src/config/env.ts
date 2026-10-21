import 'dotenv/config';
import { z } from 'zod';

const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);

export const envConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3100),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.preprocess(
      emptyAsUndefined,
      z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
    ),

    // BETTER AUTH (standby)
    BETTER_AUTH_SECRET: z.preprocess(emptyAsUndefined, z.string().min(32).optional()),
    BETTER_AUTH_URL: z.url().default('http://localhost:3100'),

    // CORS
    CORS_ORIGIN: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),

    // PROXY
    TRUSTED_PROXY: z.preprocess(emptyAsUndefined, z.string().optional()),

    // DOCS
    DOC_TOKEN: z.preprocess(emptyAsUndefined, z.string().optional()),

    // DATABASE
    DATABASE_URL: z.url(),
    DB_POOL_MAX: z.coerce.number().default(20),
    DB_IDLE_TIMEOUT_MS: z.coerce.number().default(30_000),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().default(5_000),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().default(10_000),

    // REDIS
    REDIS_HOST: z.string().default('127.0.0.1'),
    REDIS_PORT: z.coerce.number().default(6379),
    REDIS_PASSWORD: z.preprocess(emptyAsUndefined, z.string().optional()),
    REDIS_TLS: z.stringbool().default(false),

    // UNDER PRESSURE
    PRESSURE_MAX_HEAP_BYTES: z.coerce.number().default(500_000_000),
    PRESSURE_MAX_RSS_BYTES: z.coerce.number().default(800_000_000),

    // REVGAS
    REVGAS_MODE: z.preprocess(emptyAsUndefined, z.enum(['live', 'hybrid', 'fake']).optional()),
    REVGAS_API_URL: z.preprocess(emptyAsUndefined, z.url().default('https://api.revgas.com/v1')),
    REVGAS_API_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
    REVGAS_ESTABLISHMENT_ID: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().positive().optional(),
    ),
    REVGAS_TIMEOUT_MS: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().positive().default(10_000),
    ),
    REVGAS_MIN_INTERVAL_MS: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().min(0).default(1_100),
    ),

    // WHATSAPP (Cloud API da Meta)
    WHATSAPP_MODE: z.preprocess(emptyAsUndefined, z.enum(['live', 'fake']).optional()),
    WHATSAPP_API_URL: z.preprocess(emptyAsUndefined, z.url().default('https://graph.facebook.com')),
    WHATSAPP_API_VERSION: z.preprocess(
      emptyAsUndefined,
      z
        .string()
        .regex(/^v\d+\.\d+$/)
        .default('v23.0'),
    ),
    WHATSAPP_ACCESS_TOKEN: z.preprocess(emptyAsUndefined, z.string().min(32).optional()),
    WHATSAPP_PHONE_NUMBER_ID: z.preprocess(emptyAsUndefined, z.string().regex(/^\d+$/).optional()),
    WHATSAPP_APP_SECRET: z.preprocess(emptyAsUndefined, z.string().min(32).optional()),
    WHATSAPP_VERIFY_TOKEN: z.preprocess(emptyAsUndefined, z.string().min(16).optional()),
    WHATSAPP_TIMEOUT_MS: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().positive().default(10_000),
    ),

    // LLM (Gemini via API compativel com OpenAI)
    LLM_MODE: z.preprocess(emptyAsUndefined, z.enum(['live', 'fake']).optional()),
    LLM_API_URL: z.preprocess(
      emptyAsUndefined,
      z.url().default('https://generativelanguage.googleapis.com/v1beta/openai'),
    ),
    LLM_API_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
    LLM_MODEL: z.preprocess(emptyAsUndefined, z.string().min(1).default('gemini-3.8-flash')),
    LLM_TIMEOUT_MS: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().positive().default(8_000),
    ),

    // VIACEP (consulta de CEP, API publica sem chave)
    VIACEP_MODE: z.preprocess(emptyAsUndefined, z.enum(['live', 'fake']).optional()),
    VIACEP_API_URL: z.preprocess(emptyAsUndefined, z.url().default('https://viacep.com.br/ws')),
    VIACEP_TIMEOUT_MS: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().positive().default(5_000),
    ),

    // LOJA (cidade e UF assumidas quando o cliente nao informa)
    STORE_CITY: z.preprocess(emptyAsUndefined, z.string().min(1).default('Teresina')),
    STORE_STATE: z.preprocess(emptyAsUndefined, z.string().length(2).default('PI')),

    // RESEND (standby)
    RESEND_API_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
    EMAIL_FROM: z.string().default('onboarding@resend.dev'),
    EMAIL_DEV_REDIRECT: z.preprocess(emptyAsUndefined, z.email().optional()),
  })
  .refine(value => value.NODE_ENV !== 'production' || !!value.CORS_ORIGIN, {
    path: ['CORS_ORIGIN'],
    message: 'CORS_ORIGIN é obrigatório em produção',
  })
  .refine(value => value.NODE_ENV !== 'production' || !value.CORS_ORIGIN?.includes('*'), {
    path: ['CORS_ORIGIN'],
    message: 'CORS_ORIGIN não pode conter "*" em produção',
  });

export const env = envConfigSchema.parse(process.env);

export type Env = z.infer<typeof envConfigSchema>;
