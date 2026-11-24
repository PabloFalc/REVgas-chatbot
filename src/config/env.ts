import 'dotenv/config';
import { z } from 'zod';
import { parseServiceHours } from '../utils/service-hours';

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
    LOG_FILE: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),

    // CORS
    CORS_ORIGIN: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),

    // PROXY
    TRUSTED_PROXY: z.preprocess(emptyAsUndefined, z.string().optional()),

    // DOCS
    DOC_TOKEN: z.preprocess(emptyAsUndefined, z.string().optional()),

    // DATABASE
    DATABASE_URL: z.url(),
    METRICS_ENABLED: z.stringbool().default(true),
    METRICS_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
    DB_POOL_MAX: z.coerce.number().default(20),
    DB_IDLE_TIMEOUT_MS: z.coerce.number().default(30_000),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().default(5_000),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().default(10_000),

    // REDIS
    REDIS_HOST: z.string().default('127.0.0.1'),
    REDIS_PORT: z.coerce.number().default(6379),
    REDIS_PASSWORD: z.preprocess(emptyAsUndefined, z.string().optional()),
    REDIS_TLS: z.stringbool().default(false),
    REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),

    // UNDER PRESSURE
    PRESSURE_MAX_HEAP_BYTES: z.coerce.number().default(500_000_000),
    PRESSURE_MAX_RSS_BYTES: z.coerce.number().default(800_000_000),

    // REVGAS
    REVGAS_MODE: z.preprocess(emptyAsUndefined, z.enum(['live', 'hybrid', 'fake']).optional()),
    REVGAS_ALLOW_LIVE_SALES: z.stringbool().default(false),
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
    WHATSAPP_ALLOWED_SENDERS: z
      .string()
      .default('')
      .transform(value =>
        value
          .split(',')
          .map(sender => sender.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().regex(/^\d+$/, 'Use só os dígitos do wa_id, ex.: 5586999990000'))),

    // LLM (Gemini via API compativel com OpenAI)
    LLM_MODE: z.preprocess(emptyAsUndefined, z.enum(['live', 'fake']).optional()),
    LLM_API_URL: z.preprocess(
      emptyAsUndefined,
      z.url().default('https://generativelanguage.googleapis.com/v1beta/openai'),
    ),
    LLM_API_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
    LLM_MODEL: z.preprocess(emptyAsUndefined, z.string().min(1).default('gemini-3.5-flash')),
    LLM_TIMEOUT_MS: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().positive().default(8_000),
    ),

    // EMBEDDING (busca semantica da base de conhecimento; cai nas variaveis LLM_*)
    EMBEDDING_API_URL: z.preprocess(emptyAsUndefined, z.url().optional()),
    EMBEDDING_API_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
    EMBEDDING_MODEL: z.preprocess(
      emptyAsUndefined,
      z.string().min(1).default('gemini-embedding-001'),
    ),
    EMBEDDING_DIMENSIONS: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().positive().default(768),
    ),
    EMBEDDING_BATCH_SIZE: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().min(1).max(100).default(16),
    ),

    AI_CALLS_PER_PHONE_HOUR: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().min(1).default(30),
    ),

    // KNOWLEDGE (base de conhecimento; limiares ainda nao calibrados, ver pnpm rag:check)
    KNOWLEDGE_DIR: z.preprocess(emptyAsUndefined, z.string().min(1).default('knowledge/base')),
    KNOWLEDGE_TOP_K: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().min(1).max(10).default(3),
    ),
    KNOWLEDGE_MIN_SIMILARITY: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().min(0).max(1).default(0.7),
    ),
    KNOWLEDGE_MIN_SIMILARITY_TEXT: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().min(0).max(1).default(0.6),
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
    STORE_PHONE: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),

    // CHATWOOT (handoff para atendente humano)
    CHATWOOT_MODE: z.preprocess(emptyAsUndefined, z.enum(['live', 'fake', 'off']).optional()),
    CHATWOOT_URL: z.preprocess(emptyAsUndefined, z.url().default('http://localhost:3000')),
    CHATWOOT_ACCOUNT_ID: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().positive().optional(),
    ),
    CHATWOOT_INBOX_ID: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().positive().optional(),
    ),
    CHATWOOT_API_TOKEN: z.preprocess(emptyAsUndefined, z.string().optional()),
    CHATWOOT_BOT_TOKEN: z.preprocess(emptyAsUndefined, z.string().optional()),
    CHATWOOT_WEBHOOK_SECRET: z.preprocess(emptyAsUndefined, z.string().min(16).optional()),
    CHATWOOT_TIMEOUT_MS: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().positive().default(5_000),
    ),

    // HORARIO DE ATENDIMENTO (vazio = sempre aberto)
    SERVICE_HOURS: z.preprocess(
      emptyAsUndefined,
      z
        .string()
        .optional()
        .superRefine((value, ctx) => {
          if (value === undefined) return;
          try {
            parseServiceHours(value);
          } catch (error) {
            ctx.addIssue({
              code: 'custom',
              message: error instanceof Error ? error.message : 'Horário de atendimento inválido',
            });
          }
        }),
    ),
  })
  .refine(value => value.NODE_ENV !== 'production' || !!value.CORS_ORIGIN, {
    path: ['CORS_ORIGIN'],
    message: 'CORS_ORIGIN é obrigatório em produção',
  })
  .refine(value => value.NODE_ENV !== 'production' || !value.CORS_ORIGIN?.includes('*'), {
    path: ['CORS_ORIGIN'],
    message: 'CORS_ORIGIN não pode conter "*" em produção',
  })
  .refine(value => value.NODE_ENV !== 'production' || !!value.REDIS_PASSWORD, {
    path: ['REDIS_PASSWORD'],
    message: 'REDIS_PASSWORD é obrigatório em produção',
  })
  .refine(value => value.REVGAS_MODE !== 'live' || value.REVGAS_ALLOW_LIVE_SALES, {
    path: ['REVGAS_ALLOW_LIVE_SALES'],
    message:
      'REVGAS_MODE=live cria vendas reais na RevGás; confirme com REVGAS_ALLOW_LIVE_SALES=true',
  })
  .refine(
    value =>
      value.NODE_ENV !== 'production' ||
      value.REVGAS_MODE === 'live' ||
      value.WHATSAPP_ALLOWED_SENDERS.length > 0,
    {
      path: ['WHATSAPP_ALLOWED_SENDERS'],
      message:
        'WHATSAPP_ALLOWED_SENDERS é obrigatório em produção com vendas simuladas (REVGAS_MODE hybrid ou fake)',
    },
  );

export const env = envConfigSchema.parse(process.env);

export type Env = z.infer<typeof envConfigSchema>;
