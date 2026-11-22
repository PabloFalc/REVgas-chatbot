import { isRecord } from '../../../utils/guards';

export type WhatsappErrorKind =
  | 'invalid_message'
  | 'unauthorized'
  | 'rate_limited'
  | 'rejected'
  | 'unavailable'
  | 'response'
  | 'unknown_outcome';

export interface WhatsappIssue {
  path: string;
  message: string;
}

export class WhatsappError extends Error {
  readonly kind: WhatsappErrorKind;
  readonly status?: number;
  readonly code?: number;

  constructor(kind: WhatsappErrorKind, message: string, status?: number, code?: number) {
    super(message);
    this.name = new.target.name;
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export class WhatsappInvalidMessageError extends WhatsappError {
  readonly issues: WhatsappIssue[];

  constructor(issues: WhatsappIssue[]) {
    super('invalid_message', 'Mensagem fora dos limites do WhatsApp');
    this.issues = issues;
  }
}

export class WhatsappUnauthorizedError extends WhatsappError {
  constructor(message: string, status?: number, code?: number) {
    super('unauthorized', message, status, code);
  }
}

export class WhatsappRateLimitedError extends WhatsappError {
  constructor(message: string, status?: number, code?: number) {
    super('rate_limited', message, status, code);
  }
}

export class WhatsappRejectedError extends WhatsappError {
  constructor(message: string, status?: number, code?: number) {
    super('rejected', message, status, code);
  }
}

export class WhatsappUnavailableError extends WhatsappError {
  constructor(message: string, status?: number, code?: number) {
    super('unavailable', message, status, code);
  }
}

export class WhatsappResponseError extends WhatsappError {
  constructor(message: string, status?: number) {
    super('response', message, status);
  }
}

export class WhatsappUnknownOutcomeError extends WhatsappError {
  constructor(message: string) {
    super('unknown_outcome', message);
  }
}

const AUTH_CODES = new Set([190]);
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);

export function graphErrorDetails(body: unknown): { message?: string; code?: number } {
  if (!isRecord(body) || !isRecord(body.error)) {
    return {};
  }
  const { message, code } = body.error;
  return {
    message: typeof message === 'string' && message ? message : undefined,
    code: typeof code === 'number' ? code : undefined,
  };
}

export function mapWhatsappError(status: number, body: unknown): WhatsappError {
  const { message, code } = graphErrorDetails(body);
  const text = message ?? `WhatsApp respondeu ${status}`;

  if (status === 401 || (code !== undefined && AUTH_CODES.has(code))) {
    return new WhatsappUnauthorizedError(text, status, code);
  }
  if (status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))) {
    return new WhatsappRateLimitedError(text, status, code);
  }
  if (status >= 500) {
    return new WhatsappUnavailableError(text, status, code);
  }
  return new WhatsappRejectedError(text, status, code);
}
