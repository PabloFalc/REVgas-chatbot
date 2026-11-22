import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env';
import { resolveKnowledgeConfig } from './knowledge.config';

function envWith(overrides: Partial<Env> = {}): Env {
  return {
    KNOWLEDGE_DIR: 'knowledge/base',
    KNOWLEDGE_TOP_K: 3,
    KNOWLEDGE_MIN_SIMILARITY: 0.7,
    KNOWLEDGE_MIN_SIMILARITY_TEXT: 0.6,
    ...overrides,
  } as Env;
}

describe('resolveKnowledgeConfig', () => {
  it('usa os defaults', () => {
    expect(resolveKnowledgeConfig(envWith())).toEqual({
      dir: 'knowledge/base',
      topK: 3,
      minSimilarity: 0.7,
      minSimilarityWithText: 0.6,
    });
  });

  it('falha quando o limiar com texto é maior que o limiar base', () => {
    expect(() =>
      resolveKnowledgeConfig(
        envWith({ KNOWLEDGE_MIN_SIMILARITY: 0.5, KNOWLEDGE_MIN_SIMILARITY_TEXT: 0.6 }),
      ),
    ).toThrow('KNOWLEDGE_MIN_SIMILARITY_TEXT não pode ser maior que KNOWLEDGE_MIN_SIMILARITY');
  });
});
