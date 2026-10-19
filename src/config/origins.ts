import { env } from './env';

export function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

export const allowAllOrigins = !env.CORS_ORIGIN || env.CORS_ORIGIN === '*';

export const allowedOrigins = allowAllOrigins ? [] : parseOrigins(env.CORS_ORIGIN ?? '');
