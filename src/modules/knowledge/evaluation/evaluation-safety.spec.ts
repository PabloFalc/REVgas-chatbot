import { describe, expect, it } from 'vitest';
import { assertSafeForEvaluation } from './evaluation-safety';

const BASE = ['revenda-chama-azul.md'];

describe('assertSafeForEvaluation', () => {
  it('recusa em produção', () => {
    expect(() => assertSafeForEvaluation([], BASE, 'production')).toThrow(/produção/);
  });

  it('recusa quando o índice tem trecho de outra fonte', () => {
    const keys = ['revenda-chama-azul.md#prazo-de-entrega', 'loja-real.md#bairros-atendidos'];
    expect(() => assertSafeForEvaluation(keys, BASE, 'development')).toThrow(/loja-real\.md/);
  });

  it('recusa chave sem # que não é fonte da base', () => {
    expect(() => assertSafeForEvaluation(['outra'], BASE, 'test')).toThrow(/outra/);
  });

  it('índice vazio passa', () => {
    expect(() => assertSafeForEvaluation([], BASE, 'development')).not.toThrow();
  });

  it('índice só com as fontes da base fictícia passa', () => {
    const keys = ['revenda-chama-azul.md#prazo-de-entrega', 'revenda-chama-azul.md#troco'];
    expect(() => assertSafeForEvaluation(keys, BASE, 'test')).not.toThrow();
  });
});
