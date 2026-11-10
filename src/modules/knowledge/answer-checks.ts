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
  'mil',
  'meia',
]);

const MONEY_PATTERN = /r\$|\breais?\b|\bcentavos?\b/i;
const PERCENT_PATTERN = /%|\bpor ?cento\b/;

export type AnswerCheck =
  | { ok: true; text: string; used: AnswerSource[] }
  | { ok: false; reason: AnswerRejection };

function numbersIn(text: string): Set<string> {
  return new Set((text.match(/\d+/g) ?? []).map(run => run.replace(/^0+(?=\d)/, '')));
}

function numberWordsIn(normalized: string): Set<string> {
  return new Set(normalized.split(/[^a-z0-9]+/).filter(word => NUMBER_WORDS.has(word)));
}

function citedSources(refs: string[], sent: AnswerSource[]): AnswerSource[] | null {
  const byRef = new Map(sent.map(source => [source.ref, source]));
  const used: AnswerSource[] = [];
  for (const ref of refs) {
    const source = byRef.get(ref.trim());
    if (!source) return null;
    if (!used.includes(source)) used.push(source);
  }
  return used;
}

function onlyKnownNumbers(text: string, used: AnswerSource[]): boolean {
  const sourceText = used.map(source => `${source.title}\n${source.content}`).join('\n');
  const allowedNumbers = numbersIn(sourceText);
  const allowedWords = numberWordsIn(normalizeText(sourceText));
  return (
    [...numbersIn(text)].every(value => allowedNumbers.has(value)) &&
    [...numberWordsIn(normalizeText(text))].every(word => allowedWords.has(word))
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
  if (!onlyKnownNumbers(text, used)) return { ok: false, reason: 'number_not_in_sources' };

  return { ok: true, text, used };
}
