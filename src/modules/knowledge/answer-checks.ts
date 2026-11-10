import { normalizeText } from '../../utils/text';
import type { AnswerRejection, AnswerSource } from './contracts/knowledge.types';

export const ANSWER_MAX_LENGTH = 600;

const NUMBER_WORDS = new Set([
  'dois',
  'duas',
  'tres',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'catorze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
  'cem',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
  'mil',
  'meia',
  'meio',
  'zero',
  'primeiro',
  'primeira',
  'terceiro',
  'terceira',
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta',
  'sabado',
  'sabados',
  'domingo',
  'domingos',
]);

const PRICE_PREFIXES = [
  'gratis',
  'gratuit',
  'desconto',
  'promoc',
  'preco',
  'custa',
  'custo',
  'barat',
  'valor',
  'cobr',
  'taxa',
];
const PRICE_WORDS = new Set(['caro', 'cara']);

const MONEY_PATTERN = /r\$|\bre(al|ais)\b|\bcentavos?\b/i;
const PERCENT_PATTERN = /%|\bpor ?cento\b/;
const NAME_PATTERN = /(?<![\p{L}\p{N}])\p{Lu}\p{L}{2,}(?![\p{L}\p{N}])/gu;
const SENTENCE_START_PATTERN = /(?:^\s*|[.!?:]\s+|\n\s*)$/u;

export type AnswerCheck =
  | { ok: true; text: string; used: AnswerSource[] }
  | { ok: false; reason: AnswerRejection };

function numbersIn(text: string): Set<string> {
  return new Set((text.match(/\d+/g) ?? []).map(run => run.replace(/^0+(?=\d)/, '')));
}

function wordsOf(normalized: string): string[] {
  return normalized.split(/[^a-z0-9]+/).filter(word => word.length > 0);
}

function numberWordsIn(normalized: string): Set<string> {
  return new Set(wordsOf(normalized).filter(word => NUMBER_WORDS.has(word)));
}

function priceStem(word: string): string | undefined {
  if (PRICE_WORDS.has(word)) return word;
  return PRICE_PREFIXES.find(prefix => word.startsWith(prefix));
}

function priceStemsIn(normalized: string): Set<string> {
  const stems = new Set<string>();
  for (const word of wordsOf(normalized)) {
    const stem = priceStem(word);
    if (stem) stems.add(stem);
  }
  return stems;
}

function normalizeRef(ref: string): string {
  return ref
    .trim()
    .toUpperCase()
    .replace(/^[[(]+/u, '')
    .replace(/[\p{P}\s]+$/u, '');
}

function textOfSources(used: AnswerSource[]): string {
  return normalizeText(used.map(source => `${source.title}\n${source.content}`).join('\n'));
}

function citedSources(refs: string[], sent: AnswerSource[]): AnswerSource[] | null {
  const byRef = new Map(sent.map(source => [source.ref, source]));
  const used: AnswerSource[] = [];
  for (const ref of refs) {
    const source = byRef.get(normalizeRef(ref));
    if (!source) return null;
    if (!used.includes(source)) used.push(source);
  }
  return used;
}

function onlyKnownPriceWords(normalized: string, sources: string): boolean {
  const allowed = priceStemsIn(sources);
  return [...priceStemsIn(normalized)].every(stem => allowed.has(stem));
}

function namesIn(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(NAME_PATTERN)) {
    const before = text.slice(0, match.index);
    if (!SENTENCE_START_PATTERN.test(before)) names.add(normalizeText(match[0]));
  }
  return names;
}

function onlyKnownNames(text: string, sources: string): boolean {
  const words = new Set(wordsOf(sources));
  return [...namesIn(text)].every(name => words.has(name));
}

function onlyKnownNumbers(normalized: string, sources: string): boolean {
  const allowedNumbers = numbersIn(sources);
  const allowedWords = numberWordsIn(sources);
  return (
    [...numbersIn(normalized)].every(value => allowedNumbers.has(value)) &&
    [...numberWordsIn(normalized)].every(word => allowedWords.has(word))
  );
}

export function checkAnswer(
  draft: { answer: string; sources: string[] },
  sent: AnswerSource[],
): AnswerCheck {
  const text = draft.answer.trim();
  if (text.length === 0) return { ok: false, reason: 'empty' };
  if (text.length > ANSWER_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  if (draft.sources.length === 0) return { ok: false, reason: 'no_sources' };

  const used = citedSources(draft.sources, sent);
  if (!used) return { ok: false, reason: 'unknown_source' };

  const normalized = normalizeText(text);
  if (MONEY_PATTERN.test(normalized)) return { ok: false, reason: 'money' };
  if (PERCENT_PATTERN.test(normalized)) return { ok: false, reason: 'percent' };
  const sources = textOfSources(used);
  if (!onlyKnownPriceWords(normalized, sources)) return { ok: false, reason: 'price_claim' };
  if (!onlyKnownNames(text, sources)) return { ok: false, reason: 'name_not_in_sources' };
  if (!onlyKnownNumbers(normalized, sources)) {
    return { ok: false, reason: 'number_not_in_sources' };
  }

  return { ok: true, text, used };
}
