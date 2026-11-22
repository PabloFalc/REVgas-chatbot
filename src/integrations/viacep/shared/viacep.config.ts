import type { Env } from '../../../config/env';

export type ViacepMode = 'live' | 'fake';

export interface ViacepConfig {
  mode: ViacepMode;
  baseUrl: string;
  timeoutMs: number;
}

export function resolveViacepConfig(env: Env): ViacepConfig {
  return {
    mode: env.VIACEP_MODE ?? (env.NODE_ENV === 'test' ? 'fake' : 'live'),
    baseUrl: env.VIACEP_API_URL.replace(/\/+$/, ''),
    timeoutMs: env.VIACEP_TIMEOUT_MS,
  };
}
