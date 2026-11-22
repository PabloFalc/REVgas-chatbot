import { describe, expect, it } from 'vitest';
import { MASK, maskDocument, maskPhone } from './mask';

describe('maskPhone', () => {
  it('mostra só os 4 últimos dígitos', () => {
    expect(maskPhone('5586999991234')).toBe('*******1234');
    expect(maskPhone(5586999991234)).toBe('*******1234');
  });

  it('esconde tudo quando o valor é curto', () => {
    expect(maskPhone('123')).toBe(MASK);
    expect(maskPhone('')).toBe(MASK);
  });
});

describe('maskDocument', () => {
  it('mostra só os 2 últimos dígitos do CPF/CNPJ', () => {
    expect(maskDocument('12345678901')).toBe('***01');
  });

  it('esconde tudo quando o valor é curto', () => {
    expect(maskDocument('1')).toBe(MASK);
  });
});
