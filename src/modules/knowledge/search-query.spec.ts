import { toTextQuery } from './search-query';

describe('toTextQuery', () => {
  it('remove stopwords e acentos', () => {
    expect(toTextQuery('Vocês entregam no Jóquei?')).toBe('entregam | joquei');
  });

  it('separa palavras compostas', () => {
    expect(toTextQuery('aceitam vale-gás?')).toBe('aceitam | vale | gas');
  });

  it('mantém termo curto com dígito', () => {
    expect(toTextQuery('tem P13?')).toBe('p13');
  });

  it.each(['?', 'oi, bom dia', ''])('devolve null para "%s"', input => {
    expect(toTextQuery(input)).toBeNull();
  });

  it('limita a 12 termos', () => {
    const words = Array.from({ length: 20 }, (_, i) => `palavra${i}`).join(' ');
    expect(toTextQuery(words)?.split(' | ')).toHaveLength(12);
  });

  it('remove termos repetidos', () => {
    expect(toTextQuery('gas gas GAS')).toBe('gas');
  });

  it('só gera termos alfanuméricos', () => {
    expect(toTextQuery("a' | b & !c")).toBeNull();
    expect(toTextQuery("xx' | yy & !zz")).toBe('xx | yy | zz');
  });
});
