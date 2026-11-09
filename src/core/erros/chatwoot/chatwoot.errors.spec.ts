import { describe, expect, it } from 'vitest';
import { ChatwootError, mapChatwootError } from './chatwoot.errors';

describe('mapChatwootError', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'not_found'],
    [422, 'rejected'],
    [503, 'unavailable'],
  ])('mapeia %i para %s', (status, kind) => {
    const error = mapChatwootError(status);
    expect(error).toBeInstanceOf(ChatwootError);
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
  });
});
