import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from './money';

describe('formatMoney', () => {
  it('formata em reais com espaço comum', () => {
    expect(formatMoney(220)).toBe('R$ 220,00');
  });

  it('formata milhar', () => {
    expect(formatMoney(1250.5)).toBe('R$ 1.250,50');
  });
});

describe('parseMoney', () => {
  it.each([
    ['250', 250],
    ['250,00', 250],
    ['R$ 250', 250],
    ['r$250,50', 250.5],
    ['1.250,00', 1250],
    ['R$ 1.000,00', 1000],
    ['250.5', 250.5],
    ['200.00', 200],
    ['1.5', 1.5],
    ['1.000', 1000],
    ['1.500', 1500],
    ['12.500', 12500],
    ['1.000.000', 1000000],
    ['50', 50],
  ])('lê %s', (text, value) => {
    expect(parseMoney(text)).toBe(value);
  });

  it.each(['', 'abc', '-10', '0'])('recusa %s', text => {
    expect(parseMoney(text)).toBeNull();
  });
});
