import { describe, expect, it } from 'vitest';
import type { FlowInput } from './flow.types';
import { choiceOf, fit as shorten, textOf } from './input';

const choice: FlowInput = { phone: '1', content: { type: 'choice', id: 'product:12' } };
const text: FlowInput = { phone: '1', content: { type: 'text', text: 'oi' } };

describe('input', () => {
  it('choiceOf devolve o que vem depois do prefixo', () => {
    expect(choiceOf(choice, 'product')).toBe('12');
  });

  it('choiceOf com prefixo errado ou texto devolve null', () => {
    expect(choiceOf(choice, 'pay')).toBeNull();
    expect(choiceOf(text, 'product')).toBeNull();
  });

  it('textOf devolve null para escolha e o texto cru para texto', () => {
    expect(textOf(choice)).toBeNull();
    expect(textOf(text)).toBe('oi');
  });

  it('fit corta em max-1 mais reticências', () => {
    expect(shorten('abcdef', 4)).toBe('abc…');
    expect(shorten('abc', 4)).toBe('abc');
  });
});
