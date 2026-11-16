import type { Candidate, FuseOptions, RankedChunk } from './contracts/knowledge.types';

export const RRF_K = 60;
export const CANDIDATES_PER_LIST = 10;

export function fuseCandidates(
  byVector: Candidate[],
  byText: Candidate[],
  options: FuseOptions,
): RankedChunk[] {
  const merged = new Map<string, RankedChunk>();

  const add = (list: Candidate[], fromText: boolean) => {
    list.forEach((candidate, index) => {
      const contribution = 1 / (RRF_K + index + 1);
      const existing = merged.get(candidate.id);
      if (existing) {
        existing.score += contribution;
        existing.matchedText = existing.matchedText || fromText;
        existing.similarity = Math.max(existing.similarity, candidate.similarity);
      } else {
        merged.set(candidate.id, { ...candidate, score: contribution, matchedText: fromText });
      }
    });
  };

  add(byVector, false);
  add(byText, true);

  return [...merged.values()]
    .filter(
      chunk =>
        chunk.similarity >=
        (chunk.matchedText ? options.minSimilarityWithText : options.minSimilarity),
    )
    .sort((a, b) => b.score - a.score || b.similarity - a.similarity)
    .slice(0, options.topK);
}
