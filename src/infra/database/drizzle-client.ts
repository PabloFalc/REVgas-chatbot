import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../../config/env';
import * as schema from './schemas/index';

// Token
export const DRIZZLE = 'DRIZZLE_CLIENT';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
});

// ! Client do drizzle
export const db = drizzle(pool, {
  schema,
  casing: 'snake_case',
});

// ? DI do Nest para utilizar como provider
export const drizzleClient = {
  provide: DRIZZLE,
  useValue: db,
};
