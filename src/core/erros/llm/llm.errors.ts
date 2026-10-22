import { isRecord } from '../../../utils/guards';

export type LlmErrorKind =
  | 'unauthorized'
  | 'rate_limited'
  | 'rejected'
  | 'unavailable'
  | 'response'
  | 'invalid_output';

export interface LlmIssue {
  path: string;
  message: string;
}

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.name = new.target.name;
    this.kind = kind;
    this.status = status;
  }
}

export class LlmUnauthorizedError extends LlmError {
  constructor(message: string, status?: number) {
    super('unauthorized', message, status);
  }
}

export class LlmRateLimitedError extends LlmError {
  constructor(message: string, status?: number) {
    super('rate_limited', message, status);
  }
}

export class LlmRejectedError extends LlmError {
  constructor(message: string, status?: number) {
    super('rejected', message, status);
  }
}

export class LlmUnavailableError extends LlmError {
  constructor(message: string, status?: number) {
    super('unavailable', message, status);
  }
}

export class LlmResponseError extends LlmError {
  constructor(message: string, status?: number) {
    super('response', message, status);
  }
}

export class LlmInvalidOutputError extends LlmError {
  readonly issues: LlmIssue[];

  constructor(issues: LlmIssue[]) {
    super('invalid_output', 'Saída da LLM fora do schema esperado');
    this.issues = issues;
  }
}

function findReason(error: Record<string, unknown>): string | undefined {
  if (Array.isArray(error.details)) {
    for (const detail of error.details) {
      if (isRecord(detail) && typeof detail.reason === 'string' && detail.reason) {
        return detail.reason;
      }
    }
  }
  return typeof error.status === 'string' && error.status ? error.status : undefined;
}

const INVALID_KEY_MESSAGE = /api key/i;

function llmErrorBody(body: unknown): Record<string, unknown> | undefined {
  const root = Array.isArray(body) ? body[0] : body;
  return isRecord(root) && isRecord(root.error) ? root.error : undefined;
}

function isInvalidKey(error: Record<string, unknown> | undefined, reason?: string): boolean {
  if (reason === 'API_KEY_INVALID') {
    return true;
  }
  return typeof error?.message === 'string' && INVALID_KEY_MESSAGE.test(error.message);
}

export function mapLlmError(status: number, body: unknown): LlmError {
  const error = llmErrorBody(body);
  const reason = error ? findReason(error) : undefined;
  const text = reason ? `LLM respondeu ${status} (${reason})` : `LLM respondeu ${status}`;

  if (status === 401 || status === 403 || (status === 400 && isInvalidKey(error, reason))) {
    return new LlmUnauthorizedError(text, status);
  }
  if (status === 429) {
    return new LlmRateLimitedError(text, status);
  }
  if (status >= 500) {
    return new LlmUnavailableError(text, status);
  }
  return new LlmRejectedError(text, status);
}
