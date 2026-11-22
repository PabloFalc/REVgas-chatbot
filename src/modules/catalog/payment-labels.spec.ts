import { describe, expect, it } from 'vitest';
import { paymentLabel } from './payment-labels';

describe('paymentLabel', () => {
  it.each([
    ['PIX', 'Pix'],
    ['MONEY', 'Dinheiro'],
    ['CARTAO_DE_CREDITO', 'Cartão de crédito'],
    ['CARTAO_DE_DEBITO', 'Cartão de débito'],
    ['VALEGAS', 'Vale-gás'],
    ['TRANSFERENCIA_BANCARIA', 'Transferência'],
    ['FOO_BAR', 'Foo bar'],
  ])('%s -> %s', (type, label) => {
    expect(paymentLabel(type)).toBe(label);
  });
});
