import { normalizeText } from 'src/utils/text';
import type { AnswerStyle } from './contracts/knowledge.types';

const BROAD_PATTERNS = [
  /\b(?:liste|listar|listando|listem)\b/,
  /\blista (?:os|as|pra|para|quais|todos|todas)\b/,
  /\buma lista\b/,
  /\bresum\w*/,
  /\btopicos?\b/,
  /\bpasso a passo\b/,
  /\bdiferenca\b/,
  /\bcompar\w*/,
  /\btudo sobre\b/,
  /\bme (?:conta|fala|explica) tudo\b/,
  /\bo que (?:eu )?(?:preciso|devo) saber\b/,
  /\b(?:com|em|mais) detalhes?\b/,
  /\bdetalhad\w*/,
];

export function answerStyleOf(question: string): AnswerStyle {
  const normalized = normalizeText(question)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return BROAD_PATTERNS.some(pattern => pattern.test(normalized)) ? 'broad' : 'focused';
}
