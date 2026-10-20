import type { z } from 'zod';
import {
  isRetryableStatus,
  mapRevgasError,
  RevgasResponseError,
  RevgasUnavailableError,
  RevgasUnknownOutcomeError,
} from '../revgas.errors';
import { maskQuery } from './mask';

export type RevgasLogger = {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
};

export type RevgasHttpOptions = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  minIntervalMs: number;
  maxRetries?: number;
  logger: RevgasLogger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type RevgasRequest<S extends z.ZodType> = {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  schema: S;
};

const DEFAULT_MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

export class RevgasHttp {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly logger: RevgasLogger;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private tail: Promise<void> = Promise.resolve();
  private lastStart = Number.NEGATIVE_INFINITY;

  constructor(options: RevgasHttpOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
    this.minIntervalMs = options.minIntervalMs;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.logger = options.logger;
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  async request<S extends z.ZodType>(req: RevgasRequest<S>): Promise<z.infer<S>> {
    const retryable = req.method === 'GET';
    const maxAttempts = retryable ? this.maxRetries + 1 : 1;

    const body = req.body === undefined ? undefined : JSON.stringify(req.body);

    for (let attempt = 1; ; attempt++) {
      const outcome = await this.attempt(req, attempt, body);

      if (outcome.kind === 'response') {
        if (outcome.ok) {
          return this.parse(req.schema, outcome.body, outcome.status);
        }
        if (!retryable && outcome.status >= 500) {
          throw new RevgasUnknownOutcomeError(
            'RevGás server error on a write; the operation outcome is unknown',
          );
        }
        const error = mapRevgasError(outcome.status, outcome.body);
        if (retryable && attempt < maxAttempts && isRetryableStatus(outcome.status, outcome.body)) {
          await this.sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      }

      if (!retryable) {
        throw new RevgasUnknownOutcomeError(
          outcome.timedOut
            ? 'RevGás request timed out; the operation outcome is unknown'
            : 'RevGás network error; the operation outcome is unknown',
        );
      }
      if (attempt < maxAttempts) {
        await this.sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new RevgasUnavailableError(
        outcome.timedOut ? 'RevGás request timed out' : 'RevGás network error',
      );
    }
  }

  private parse<S extends z.ZodType>(schema: S, body: unknown, status: number): z.infer<S> {
    const result = schema.safeParse(body);
    if (result.success) {
      return result.data;
    }
    const issues = result.error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new RevgasResponseError(
      'RevGás response does not match the expected schema',
      issues,
      status,
    );
  }

  private async attempt<S extends z.ZodType>(
    req: RevgasRequest<S>,
    attempt: number,
    body: string | undefined,
  ): Promise<
    | { kind: 'response'; ok: boolean; status: number; body: unknown }
    | { kind: 'failure'; timedOut: boolean }
  > {
    await this.acquireSlot();
    const startedAt = this.now();
    const logBase = {
      component: 'revgas',
      method: req.method,
      path: req.path,
      query: maskQuery(req.query ?? {}),
      attempt,
    };

    try {
      const response = await this.fetchFn(this.buildUrl(req), {
        method: req.method,
        headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const parsed = parseBody(await response.text());
      const durationMs = this.now() - startedAt;
      const log = { ...logBase, status: response.status, durationMs };
      if (response.ok) {
        this.logger.info(log, 'revgas request');
      } else {
        this.logger.warn(log, 'revgas request failed');
      }
      return { kind: 'response', ok: response.ok, status: response.status, body: parsed };
    } catch (error) {
      const timedOut = isTimeout(error);
      this.logger.warn(
        { ...logBase, durationMs: this.now() - startedAt, error: timedOut ? 'timeout' : 'network' },
        'revgas request failed',
      );
      return { kind: 'failure', timedOut };
    }
  }

  private buildUrl<S extends z.ZodType>(req: RevgasRequest<S>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (value !== undefined && value !== '') {
        params.append(key, String(value));
      }
    }
    const qs = params.toString();
    return `${this.baseUrl}${req.path}${qs ? `?${qs}` : ''}`;
  }

  private acquireSlot(): Promise<void> {
    const turn = this.tail.then(async () => {
      const wait = Math.max(0, this.lastStart + this.minIntervalMs - this.now());
      if (wait > 0) {
        await this.sleep(wait);
      }
      this.lastStart = this.now();
    });
    this.tail = turn.catch(() => undefined);
    return turn;
  }
}
