import { normalizeText } from 'src/utils/text';

export const MAX_QUESTION_CHARS = 500;

const MAX_TERMS = 12;

const STOPWORDS = new Set([
  'a',
  'o',
  'as',
  'os',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'um',
  'uma',
  'que',
  'para',
  'pra',
  'por',
  'com',
  'voce',
  'voces',
  'vcs',
  'eu',
  'me',
  'meu',
  'minha',
  'se',
  'nao',
  'sim',
  'ta',
  'esta',
  'estao',
  'tem',
  'ter',
  'qual',
  'quais',
  'como',
  'onde',
  'quando',
  'quanto',
  'ola',
  'oi',
  'bom',
  'boa',
  'dia',
  'tarde',
  'noite',
  'obrigado',
  'obrigada',
  'favor',
  'gostaria',
  'queria',
  'saber',
  'pode',
  'posso',
]);

export function toTextQuery(question: string): string | null {
  const terms = new Set<string>();
  for (const token of normalizeText(question).split(/[^a-z0-9]+/)) {
    if (terms.size >= MAX_TERMS) break;
    if (token.length === 0 || STOPWORDS.has(token)) continue;
    if (token.length < 2 && !/\d/.test(token)) continue;
    terms.add(token);
  }
  return terms.size > 0 ? [...terms].join(' | ') : null;
}
