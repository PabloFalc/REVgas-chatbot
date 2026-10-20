import { describe, expect, it } from 'vitest';
import {
  LlmError,
  LlmInvalidOutputError,
  LlmRateLimitedError,
  LlmRejectedError,
  LlmUnauthorizedError,
  LlmUnavailableError,
  llmErrorDetails,
  mapLlmError,
} from './llm.errors';

describe('mapLlmError', () => {
  it('401 e 403 → LlmUnauthorizedError', () => {
    for (const status of [401, 403]) {
      const error = mapLlmError(status, {});
      expect(error).toBeInstanceOf(LlmUnauthorizedError);
      expect(error.kind).toBe('unauthorized');
      expect(error.status).toBe(status);
    }
  });

  it('400 com API_KEY_INVALID no corpo → LlmUnauthorizedError', () => {
    const body = [
      {
        error: {
          code: 400,
          message: 'API key not valid.',
          status: 'INVALID_ARGUMENT',
          details: [{ reason: 'API_KEY_INVALID' }],
        },
      },
    ];
    expect(mapLlmError(400, body)).toBeInstanceOf(LlmUnauthorizedError);
  });

  it('400 sem API_KEY_INVALID → LlmRejectedError', () => {
    expect(
      mapLlmError(400, { error: { message: 'x', status: 'INVALID_ARGUMENT' } }),
    ).toBeInstanceOf(LlmRejectedError);
  });

  it('429 → LlmRateLimitedError com status 429', () => {
    const error = mapLlmError(429, {});
    expect(error).toBeInstanceOf(LlmRateLimitedError);
    expect(error.status).toBe(429);
  });

  it('500 e 503 → LlmUnavailableError', () => {
    for (const status of [500, 503]) {
      const error = mapLlmError(status, {});
      expect(error).toBeInstanceOf(LlmUnavailableError);
      expect(error.status).toBe(status);
    }
  });

  it('outros 4xx → LlmRejectedError', () => {
    for (const status of [400, 404, 422]) {
      expect(mapLlmError(status, {})).toBeInstanceOf(LlmRejectedError);
    }
  });

  it('lê a mensagem no formato objeto { error: { message } }', () => {
    expect(mapLlmError(400, { error: { message: 'modelo inexistente' } }).message).toBe(
      'modelo inexistente',
    );
  });

  it('lê a mensagem no formato array [{ error: { message } }]', () => {
    expect(mapLlmError(400, [{ error: { message: 'modelo inexistente' } }]).message).toBe(
      'modelo inexistente',
    );
  });

  it('sem mensagem no corpo → "LLM respondeu {status}"', () => {
    expect(mapLlmError(502, null).message).toBe('LLM respondeu 502');
    expect(mapLlmError(404, { error: {} }).message).toBe('LLM respondeu 404');
  });

  it('trunca mensagens com mais de 200 caracteres', () => {
    expect(
      mapLlmError(400, { error: { message: 'x'.repeat(500) } }).message.length,
    ).toBeLessThanOrEqual(200);
  });
});

describe('llmErrorDetails', () => {
  it('usa error.status como reason quando não há details', () => {
    expect(llmErrorDetails({ error: { status: 'RESOURCE_EXHAUSTED' } }).reason).toBe(
      'RESOURCE_EXHAUSTED',
    );
  });

  it('prefere details[].reason e ignora corpo inválido', () => {
    expect(
      llmErrorDetails({ error: { status: 'X', details: [{}, { reason: 'API_KEY_INVALID' }] } })
        .reason,
    ).toBe('API_KEY_INVALID');
    expect(llmErrorDetails('texto')).toEqual({});
    expect(llmErrorDetails([])).toEqual({});
  });
});

describe('LlmInvalidOutputError', () => {
  it('guarda issues e tem kind invalid_output', () => {
    const issues = [{ path: 'intent', message: 'Required' }];
    const error = new LlmInvalidOutputError(issues);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe('invalid_output');
    expect(error.issues).toEqual(issues);
    expect(error.message).toBe('Saída da LLM fora do schema esperado');
    expect(error.name).toBe('LlmInvalidOutputError');
  });
});
