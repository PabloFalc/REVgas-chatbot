import { normalizeText } from 'src/utils/text';

const YOU = '(?:voce|vc|vcs|voces)';
const NOUN = '(?:duvidas?|perguntas?|assuntos?)';

const PATTERNS = [
  new RegExp(`\\bo que ${YOU} (?:sabe|consegue|pode)\\b`),
  new RegExp(`\\b(?:quais|que) (?:tipos? de )?${NOUN}\\b`),
  /\bsobre o que (?:eu )?(?:posso|da pra|consigo)\b/,
];

const ABOUT_WHAT = /\bsobre o que\b/g;
const ABOUT = /\bsobre\b/;

function words(text: string): string {
  return normalizeText(text)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isCapabilitiesQuestion(text: string): boolean {
  const normalized = words(text);
  if (!normalized || ABOUT.test(normalized.replace(ABOUT_WHAT, ''))) return false;
  return PATTERNS.some(pattern => pattern.test(normalized));
}
