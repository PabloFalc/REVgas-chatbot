import { isRecord } from '../../../utils/guards';

export type RevgasErrorKind =
  | 'unauthorized'
  | 'blocked'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'duplicate'
  | 'unavailable'
  | 'response'
  | 'unknown_outcome';

export interface RevgasFieldError {
  field: string;
  message: string;
}

export interface RevgasIssue {
  path: string;
  message: string;
}

export class RevgasError extends Error {
  readonly kind: RevgasErrorKind;
  readonly status?: number;

  constructor(kind: RevgasErrorKind, message: string, status?: number) {
    super(message);
    this.name = new.target.name;
    this.kind = kind;
    this.status = status;
  }
}

export class RevgasUnauthorizedError extends RevgasError {
  constructor(message: string, status = 401) {
    super('unauthorized', message, status);
  }
}

export class RevgasBlockedError extends RevgasError {
  constructor(message: string, status = 402) {
    super('blocked', message, status);
  }
}

export class RevgasForbiddenError extends RevgasError {
  constructor(message: string, status = 403) {
    super('forbidden', message, status);
  }
}

export class RevgasNotFoundError extends RevgasError {
  constructor(message: string, status = 404) {
    super('not_found', message, status);
  }
}

export class RevgasValidationError extends RevgasError {
  readonly fields: RevgasFieldError[];

  constructor(message: string, fields: RevgasFieldError[] = [], status?: number) {
    super('validation', message, status);
    this.fields = fields;
  }
}

export class RevgasDuplicateError extends RevgasError {
  readonly existingId?: number;

  constructor(message: string, existingId?: number, status = 409) {
    super('duplicate', message, status);
    this.existingId = existingId;
  }
}

export class RevgasUnavailableError extends RevgasError {
  constructor(message: string, status?: number) {
    super('unavailable', message, status);
  }
}

export class RevgasResponseError extends RevgasError {
  readonly issues: RevgasIssue[];

  constructor(message: string, issues: RevgasIssue[] = [], status?: number) {
    super('response', message, status);
    this.issues = issues;
  }
}

export class RevgasUnknownOutcomeError extends RevgasError {
  constructor(message: string) {
    super('unknown_outcome', message);
  }
}

function bodyMessage(body: unknown): string | undefined {
  if (isRecord(body) && typeof body.message === 'string' && body.message) {
    return body.message;
  }
  return undefined;
}

function extractFields(body: unknown): RevgasFieldError[] {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    return [];
  }
  const fields: RevgasFieldError[] = [];
  for (const item of body.data) {
    if (isRecord(item) && typeof item.field === 'string' && typeof item.message === 'string') {
      fields.push({ field: item.field, message: item.message });
    }
  }
  return fields;
}

function extractExistingId(body: unknown): number | undefined {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    return undefined;
  }
  const first: unknown = body.data[0];
  if (!isRecord(first)) {
    return undefined;
  }
  const raw = first.value_id;
  const id =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\d+$/.test(raw)
        ? Number(raw)
        : Number.NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function isLock(status: number, body: unknown): boolean {
  return status === 409 && /lock/i.test(bodyMessage(body) ?? '');
}

export function isRetryableStatus(status: number, body: unknown): boolean {
  return status === 429 || status >= 500 || isLock(status, body);
}

export function mapRevgasError(status: number, body: unknown): RevgasError {
  const message = bodyMessage(body);
  if (isRetryableStatus(status, body)) {
    return new RevgasUnavailableError(message ?? `RevGás unavailable (${status})`, status);
  }
  switch (status) {
    case 401:
      return new RevgasUnauthorizedError(message ?? 'unauthorized');
    case 402:
      return new RevgasBlockedError(message ?? 'blocked');
    case 403:
      return new RevgasForbiddenError(message ?? 'forbidden');
    case 404:
      return new RevgasNotFoundError(message ?? 'not found');
    case 400:
    case 422:
      return new RevgasValidationError(message ?? 'validation error', extractFields(body), status);
    case 409:
      return new RevgasDuplicateError(message ?? 'duplicate object', extractExistingId(body));
    default:
      return new RevgasError('response', message ?? `unexpected status ${status}`, status);
  }
}
