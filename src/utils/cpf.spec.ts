import { describe, expect, it } from 'vitest';
import { isValidCpf, onlyDigits, removeCpfs } from './cpf';

describe('isValidCpf', () => {
  it('aceita CPF válido com ou sem pontuação', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });

  it('recusa dígito errado, tamanho errado e dígitos repetidos', () => {
    expect(isValidCpf('52998224724')).toBe(false);
    expect(isValidCpf('5299822472')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
  });
});

describe('onlyDigits', () => {
  it('remove tudo que não é dígito', () => {
    expect(onlyDigits('a1.2-3')).toBe('123');
  });
});

describe('removeCpfs', () => {
  it('remove CPFs com e sem pontuação e preserva o resto', () => {
    const result = removeCpfs('cpf 123.456.789-09 e 12345678909, casa 120');
    expect(result).not.toContain('123.456.789-09');
    expect(result).not.toContain('12345678909');
    expect(result).toContain('casa 120');
  });
});
