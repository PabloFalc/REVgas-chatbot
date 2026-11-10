import { describe, expect, it } from 'vitest';
import { isValidCpf, onlyDigits, removeCpfMentions, removeCpfs, removeLongDigitRuns } from './cpf';

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

describe('removeLongDigitRuns', () => {
  it.each([
    ['123 456 789 09'],
    ['123.456.789/09'],
    ['cpf 123.456.789'],
    ['1234567890'],
    ['123456789012'],
    ['86 99999 1234'],
    ['123-456 789.09'],
  ])('remove os dígitos de %s', text => {
    expect(removeLongDigitRuns(`meu ${text}, entregam?`)).not.toMatch(/\d/);
  });

  it('remove o telefone com DDD entre parênteses', () => {
    const result = removeLongDigitRuns('fone (86) 99999-1234 ok');
    expect(result).not.toContain('99999');
    expect(result).not.toContain('1234');
    expect(result).toContain('ok');
  });

  it('preserva números curtos', () => {
    expect(removeLongDigitRuns('botijão P13 em 40 minutos, troca em 7 dias')).toBe(
      'botijão P13 em 40 minutos, troca em 7 dias',
    );
  });

  it('respeita o mínimo de dígitos informado', () => {
    expect(removeLongDigitRuns('casa 120 456', 7)).toBe('casa 120 456');
    expect(removeLongDigitRuns('casa 120 456', 6)).toBe('casa ');
  });

  it('remove telefone fixo de 8 dígitos por padrão', () => {
    expect(removeLongDigitRuns('fone 3222-1234 ok')).toBe('fone  ok');
    expect(removeLongDigitRuns('casa 1234567')).toBe('casa 1234567');
  });
});

describe('removeCpfMentions', () => {
  it.each([
    ['meu cpf termina em 0909', '0909'],
    ['cpf: 123', '123'],
    ['CPF 529.982', '529'],
    ['o Cpf é 12-34', '12'],
    ['meu c.p.f é 123', '123'],
  ])('remove os dígitos depois de cpf em %j', (text, digits) => {
    const result = removeCpfMentions(text);
    expect(result).not.toContain(digits);
    expect(result).not.toMatch(/\d/);
  });

  it('preserva o texto em volta', () => {
    expect(removeCpfMentions('meu cpf termina em 0909, entregam?')).toBe(
      'meu cpf termina em , entregam?',
    );
  });

  it('dígitos depois de mais de 3 palavras ficam', () => {
    expect(removeCpfMentions('cpf eu mando depois, quero 2 botijões')).toBe(
      'cpf eu mando depois, quero 2 botijões',
    );
  });

  it.each(['botijão P13 em 40 minutos', 'troca em 7 dias', 'reclamação em 24 horas'])(
    'sem cpf o texto fica igual: %j',
    text => {
      expect(removeCpfMentions(text)).toBe(text);
    },
  );
});

describe('removeCpfs → removeCpfMentions → removeLongDigitRuns', () => {
  const clean = (text: string) => removeLongDigitRuns(removeCpfMentions(removeCpfs(text)));

  it.each(['meu cpf termina em 0909', 'cpf: 123', 'liga no 3222-1234'])(
    'remove os dígitos de %j',
    text => {
      expect(clean(text)).not.toMatch(/\d/);
    },
  );

  it.each(['P13', '40 minutos', '7 dias', '24 horas'])('%j sobrevive', text => {
    expect(clean(`tem ${text}?`)).toBe(`tem ${text}?`);
  });
});
