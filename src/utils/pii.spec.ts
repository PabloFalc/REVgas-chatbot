import { describe, expect, it } from 'vitest';
import { PII_MARKER, sanitizeForLlm } from './pii';

describe('sanitizeForLlm', () => {
  it('mascara CPF com espaços, pontos e sem separador', () => {
    for (const cpf of ['123 456 789 09', '123.456.789-09', '12345678909', '123.456.789/09']) {
      const result = sanitizeForLlm(`meu documento ${cpf}, quero gás`);
      expect(result).toBe('meu documento [CPF], quero gás');
    }
    expect(sanitizeForLlm('cpf: 123.456')).toBe('cpf: [CPF]');
  });

  it('mascara telefone e e-mail', () => {
    for (const phone of [
      '5511900000000',
      '+55 11 90000-0001',
      '(11) 90000-0000',
      '11 90000 0001',
      '1132221234',
      '90000-0000',
      '3222-1234',
    ]) {
      expect(sanitizeForLlm(`liga no ${phone} ok`)).toBe('liga no [telefone] ok');
    }
    expect(sanitizeForLlm('manda pra cliente.teste+1@example.com por favor')).toBe(
      'manda pra [e-mail] por favor',
    );
  });

  it('mantém CEP e número da casa no texto de endereço', () => {
    for (const address of [
      'Rua das Flores 120 64000-000, Centro',
      'Rua das Flores, 120, CEP 64000000',
      'Av. Frei Serafim nº 2280 64001 020 apto 302',
      'Quadra 12 casa 7, 64000-000',
    ]) {
      expect(sanitizeForLlm(address)).toBe(address);
    }
    expect(
      sanitizeForLlm('Rua das Flores 120 64000-000, fone (11) 90000-0000, cpf 123.456.789-09'),
    ).toBe('Rua das Flores 120 64000-000, fone [telefone], cpf [CPF]');
    expect(sanitizeForLlm('cpf 123.456.789-09 casa 120, 64000-000')).toBe(
      'cpf [CPF] casa 120, 64000-000',
    );
  });

  it('PII_MARKER reconhece só os marcadores', () => {
    expect(
      sanitizeForLlm('123.456.789-09 ? (11) 90000-0000 a@example.com').replace(PII_MARKER, ''),
    ).toBe(' ?  ');
  });
});
