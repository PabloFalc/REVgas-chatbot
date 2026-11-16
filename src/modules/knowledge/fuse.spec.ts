import type { Candidate } from './contracts/knowledge.types';
import { fuseCandidates } from './fuse';

const options = { topK: 3, minSimilarity: 0.7, minSimilarityWithText: 0.6 };

function cand(id: string, similarity: number): Candidate {
  return { id, source: 's', title: id, content: id, similarity };
}

describe('fuseCandidates', () => {
  it('corta abaixo da similaridade', () => {
    const result = fuseCandidates([cand('a', 0.9), cand('b', 0.5)], [], options);
    expect(result.map(r => r.id)).toEqual(['a']);
  });

  it('casar no texto baixa o corte', () => {
    const result = fuseCandidates(
      [cand('a', 0.9), cand('b', 0.65), cand('c', 0.55)],
      [cand('b', 0.65), cand('c', 0.55)],
      options,
    );
    expect(result.map(r => r.id)).toEqual(['b', 'a']);
    expect(result.find(r => r.id === 'b')?.matchedText).toBe(true);
    expect(result.find(r => r.id === 'a')?.matchedText).toBe(false);
  });

  it('ordena por RRF', () => {
    const result = fuseCandidates([cand('a', 0.8), cand('b', 0.78)], [cand('b', 0.78)], options);
    expect(result.map(r => r.id)).toEqual(['b', 'a']);
    expect(result[0].score).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(result[1].score).toBeCloseTo(1 / 61, 10);
  });

  it('empate de score desfeito pela similaridade', () => {
    const result = fuseCandidates([cand('a', 0.8)], [cand('b', 0.9)], options);
    expect(result.map(r => r.id)).toEqual(['b', 'a']);
  });

  it('limita a topK', () => {
    const vector = ['a', 'b', 'c', 'd', 'e'].map(id => cand(id, 0.9));
    expect(fuseCandidates(vector, [], options)).toHaveLength(3);
  });

  it('nada passa devolve lista vazia', () => {
    expect(fuseCandidates([cand('a', 0.1)], [], options)).toEqual([]);
  });
});
