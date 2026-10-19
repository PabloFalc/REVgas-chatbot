import { describe, expect, it } from 'vitest';
import { parseTrustProxy } from './trust-proxy';

describe('parseTrustProxy', () => {
  it('retorna false quando indefinido', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
  });

  it('retorna false para "false"', () => {
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('retorna true para "true"', () => {
    expect(parseTrustProxy('true')).toBe(true);
  });

  it('rejeita contagem de hops', () => {
    expect(() => parseTrustProxy('1')).toThrow(/IP\/CIDR/);
  });

  it('retorna a string para CIDR/IP', () => {
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
  });
});
