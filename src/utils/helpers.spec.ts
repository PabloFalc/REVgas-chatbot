import { describe, expect, it } from 'vitest';
import { isRecord, isTimeoutError } from './guards';
import { parseJsonOrText } from './parse-json';
import { safeEqual } from './safe-equal';

describe('safeEqual', () => {
  it('compara strings, inclusive de tamanhos diferentes', () => {
    expect(safeEqual('segredo', 'segredo')).toBe(true);
    expect(safeEqual('segredo', 'segredO')).toBe(false);
    expect(safeEqual('segredo', 'segredo-maior')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('parseJsonOrText', () => {
  it('devolve o JSON quando é válido e o texto quando não é', () => {
    expect(parseJsonOrText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonOrText('<html>erro</html>')).toBe('<html>erro</html>');
    expect(parseJsonOrText('')).toBe('');
  });
});

describe('isRecord', () => {
  it('aceita objetos e arrays, recusa null e primitivos', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
});

describe('isTimeoutError', () => {
  it('reconhece o erro de AbortSignal.timeout', () => {
    const timeout = new Error('expirou');
    timeout.name = 'TimeoutError';
    expect(isTimeoutError(timeout)).toBe(true);
    expect(isTimeoutError(new TypeError('fetch failed'))).toBe(false);
    expect(isTimeoutError('TimeoutError')).toBe(false);
  });
});
