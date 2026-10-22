import { describe, expect, it } from 'vitest';
import type { FlowInput } from './flow.types';
import { choiceOf, clip, textOf } from './input';

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

  it('clip corta em max-1 mais reticências', () => {
    expect(clip('abcdef', 4)).toBe('abc…');
    expect(clip('abc', 4)).toBe('abc');
  });
});
