import { env } from 'src/config/env';

export function debugDetails<T>(payload: T): T | undefined {
  return env.NODE_ENV !== 'production' ? payload : undefined;
}
