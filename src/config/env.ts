import { z } from "zod";

const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(emptyAsUndefined, schema.optional());

const positiveInt = (fallback: number) =>
  z.preprocess(emptyAsUndefined, z.coerce.number().int().positive().default(fallback));

const port = (fallback: number) =>
  z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(65535).default(fallback));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_PORT: port(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PUBLIC_URL: optional(z.url()),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DB_SSL_MODE: optional(z.enum(["disable", "require", "verify-full"])),
  DB_SSL_CA_PATH: optional(z.string()),
  CACHE_URL: z.url({ protocol: /^rediss?$/ }),
  CONVERSATION_TTL_SECONDS: positiveInt(3600),

  ERP_API_URL: optional(z.url()),
  ERP_API_KEY: optional(z.string()),
  ERP_TIMEOUT_MS: positiveInt(10000),
  ERP_MAX_RETRIES: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(0).default(3)),
  ERP_RETRY_BASE_DELAY_MS: positiveInt(500),

  MESSAGING_PROVIDER: z.enum(["whatsapp", "evolution"]).default("whatsapp"),

  WHATSAPP_API_URL: z.url().default("https://graph.facebook.com/v23.0"),
  WHATSAPP_ACCESS_TOKEN: optional(z.string()),
  WHATSAPP_PHONE_NUMBER_ID: optional(z.string().regex(/^\d+$/)),
  WHATSAPP_VERIFY_TOKEN: optional(z.string()),
  WHATSAPP_APP_SECRET: optional(z.string()),

  EVOLUTION_API_URL: optional(z.url()),
  EVOLUTION_API_KEY: optional(z.string()),
  EVOLUTION_INSTANCE: optional(z.string()),

  LLM_PROVIDER: optional(z.string()),
  LLM_API_KEY: optional(z.string()),
  LLM_MODEL: optional(z.string()),
  LLM_TIMEOUT_MS: positiveInt(15000),
  LLM_CONFIDENCE_THRESHOLD: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().min(0).max(1).default(0.7),
  ),

  ORDER_DUPLICATE_WINDOW_MINUTES: positiveInt(10),
  HANDOFF_CONTACT: optional(z.string()),

  CEP_API_URL: z.url().default("https://viacep.com.br/ws"),
});

export type Env = z.infer<typeof envSchema>;

const result = envSchema.safeParse(Bun.env);

if (!result.success) {
  console.error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  process.exit(1);
}

export const env: Env = result.data;
