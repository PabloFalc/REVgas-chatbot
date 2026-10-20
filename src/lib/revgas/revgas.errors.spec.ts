import { describe, expect, it } from 'vitest';
import {
  isRetryableStatus,
  mapRevgasError,
  RevgasBlockedError,
  RevgasDuplicateError,
  RevgasError,
  RevgasForbiddenError,
  RevgasNotFoundError,
  RevgasResponseError,
  RevgasUnauthorizedError,
  RevgasUnavailableError,
  RevgasUnknownOutcomeError,
  RevgasValidationError,
} from './revgas.errors';

describe('mapRevgasError', () => {
  it.each([
    [401, RevgasUnauthorizedError, 'unauthorized', 'unauthorized user'],
    [402, RevgasBlockedError, 'blocked', 'Blocked user'],
    [403, RevgasForbiddenError, 'forbidden', "User doesn't have access to this resource"],
    [404, RevgasNotFoundError, 'not_found', 'not found'],
  ])('maps %i', (status, cls, kind, message) => {
    const error = mapRevgasError(status, { message });
    expect(error).toBeInstanceOf(cls);
    expect(error).toBeInstanceOf(RevgasError);
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.message).toBe(message);
  });

  it('maps 422 with fields', () => {
    const fields = [{ field: 'name', message: 'required' }];
    const error = mapRevgasError(422, { data: fields, message: 'Request error' });
    expect(error).toBeInstanceOf(RevgasValidationError);
    expect((error as RevgasValidationError).fields).toEqual(fields);
    expect(error.status).toBe(422);
  });

  it('maps 400 with empty fields', () => {
    const error = mapRevgasError(400, { message: 'x' });
    expect(error).toBeInstanceOf(RevgasValidationError);
    expect((error as RevgasValidationError).fields).toEqual([]);
    expect(error.message).toBe('x');
  });

  it('maps 409 duplicate with existingId', () => {
    const error = mapRevgasError(409, {
      message: 'An object with requested data already exists',
      data: [{ filters: [{ filter: 'phone', value: 'x' }], value_id: '123' }],
    });
    expect(error).toBeInstanceOf(RevgasDuplicateError);
    expect((error as RevgasDuplicateError).existingId).toBe(123);
  });

  it('maps 409 duplicate without usable id', () => {
    const error = mapRevgasError(409, { message: 'An object with requested data already exists' });
    expect(error).toBeInstanceOf(RevgasDuplicateError);
    expect((error as RevgasDuplicateError).existingId).toBeUndefined();
  });

  it('maps 409 lock to unavailable and retryable', () => {
    const body = { message: 'cannot modify object due to lock, try again' };
    expect(mapRevgasError(409, body)).toBeInstanceOf(RevgasUnavailableError);
    expect(isRetryableStatus(409, body)).toBe(true);
  });

  it('maps 429 and 5xx to unavailable', () => {
    expect(mapRevgasError(429, undefined)).toBeInstanceOf(RevgasUnavailableError);
    expect(mapRevgasError(500, { message: 'internal server error' })).toBeInstanceOf(
      RevgasUnavailableError,
    );
  });

  it('does not throw on string or undefined bodies', () => {
    const html = mapRevgasError(500, '<html>bad gateway</html>');
    expect(html).toBeInstanceOf(RevgasUnavailableError);
    expect(html.status).toBe(500);
    expect(mapRevgasError(500, undefined)).toBeInstanceOf(RevgasUnavailableError);
    expect(mapRevgasError(422, 'oops')).toBeInstanceOf(RevgasValidationError);
    expect(mapRevgasError(409, null)).toBeInstanceOf(RevgasDuplicateError);
  });

  it('maps unexpected status to generic error', () => {
    const error = mapRevgasError(418, { message: 'teapot' });
    expect(error.constructor).toBe(RevgasError);
    expect(error.status).toBe(418);
  });
});

describe('isRetryableStatus', () => {
  it('is true for 429 and >=500', () => {
    expect(isRetryableStatus(429, undefined)).toBe(true);
    expect(isRetryableStatus(503, 'x')).toBe(true);
  });

  it('is false for other statuses and non-lock 409', () => {
    expect(isRetryableStatus(400, { message: 'x' })).toBe(false);
    expect(
      isRetryableStatus(409, { message: 'An object with requested data already exists' }),
    ).toBe(false);
    expect(isRetryableStatus(409, undefined)).toBe(false);
  });
});

describe('other errors', () => {
  it('builds validation error from fields', () => {
    const error = new RevgasValidationError('bad', [{ field: 'a.b', message: 'm' }]);
    expect(error.kind).toBe('validation');
    expect(error.fields).toHaveLength(1);
  });

  it('builds response and unknown outcome errors', () => {
    const response = new RevgasResponseError('schema', [{ path: 'id', message: 'required' }]);
    expect(response.kind).toBe('response');
    expect(response.issues).toHaveLength(1);
    expect(new RevgasUnknownOutcomeError('timeout').kind).toBe('unknown_outcome');
    expect(new RevgasUnavailableError('down').kind).toBe('unavailable');
  });
});
