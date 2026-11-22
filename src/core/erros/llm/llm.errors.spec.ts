import { describe, expect, it } from 'vitest';
import {
  LlmError,
  LlmInvalidOutputError,
  LlmRateLimitedError,
  LlmRejectedError,
  LlmUnauthorizedError,
  LlmUnavailableError,
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

  it('400 do endpoint compatível com mensagem de chave inválida → LlmUnauthorizedError', () => {
    const body = [
      {
        error: {
          code: 400,
          message: 'Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
        },
      },
    ];
    const error = mapLlmError(400, body);
    expect(error).toBeInstanceOf(LlmUnauthorizedError);
    expect(error.message).toBe('LLM respondeu 400 (INVALID_ARGUMENT)');
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

  it('mensagem só com status e reason, sem o texto do provedor', () => {
    const error = mapLlmError(400, {
      error: { message: 'segredo: Moro na Rua X', status: 'INVALID_ARGUMENT' },
    });
    expect(error.message).toBe('LLM respondeu 400 (INVALID_ARGUMENT)');
    expect(error.message).not.toContain('segredo');
  });

  it('usa error.status como reason quando não há details', () => {
    expect(mapLlmError(429, { error: { status: 'RESOURCE_EXHAUSTED' } }).message).toBe(
      'LLM respondeu 429 (RESOURCE_EXHAUSTED)',
    );
  });

  it('lê o reason no formato array [{ error }]', () => {
    expect(
      mapLlmError(400, [{ error: { message: 'x', details: [{ reason: 'BAD' }] } }]).message,
    ).toBe('LLM respondeu 400 (BAD)');
  });

  it('sem reason → "LLM respondeu {status}"', () => {
    expect(mapLlmError(502, null).message).toBe('LLM respondeu 502');
    expect(mapLlmError(404, { error: { message: 'texto do provedor' } }).message).toBe(
      'LLM respondeu 404',
    );
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
