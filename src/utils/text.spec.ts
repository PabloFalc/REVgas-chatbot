import { describe, expect, it } from 'vitest';
import { normalizeText, truncate } from './text';

describe('normalizeText', () => {
  it('tira acento, caixa e espaços das pontas', () => {
    expect(normalizeText('  BOTÕES ')).toBe('botoes');
    expect(normalizeText('Pix à Vista')).toBe('pix a vista');
  });
});

describe('truncate', () => {
  it('corta acima do limite e marca com reticências', () => {
    expect(truncate('abcdef', 3)).toBe('abc…');
  });

  it('mantém textos dentro do limite', () => {
    expect(truncate('abc', 3)).toBe('abc');
  });
});
