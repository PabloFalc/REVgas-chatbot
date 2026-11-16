import { normalizeText } from './text';

const PROFANE_WORDS = [
  'arrombada',
  'arrombado',
  'babaca',
  'bitch',
  'boceta',
  'bosta',
  'buceta',
  'cacete',
  'caraio',
  'caralho',
  'corna',
  'corno',
  'crl',
  'cu',
  'cusao',
  'cuzao',
  'cuzinho',
  'desgraca',
  'desgracada',
  'desgracado',
  'escrota',
  'escroto',
  'fdp',
  'foda',
  'fodase',
  'fode',
  'foder',
  'fodeu',
  'fodida',
  'fodido',
  'fuck',
  'fucking',
  'fudeu',
  'fuder',
  'fudida',
  'fudido',
  'idiota',
  'imbecil',
  'karalho',
  'krl',
  'merda',
  'otaria',
  'otario',
  'piroca',
  'pnc',
  'porra',
  'pqp',
  'puta',
  'putaria',
  'putinha',
  'puto',
  'retardada',
  'retardado',
  'shit',
  'tmnc',
  'tnc',
  'vagabunda',
  'vagabundo',
  'viadinho',
  'viado',
  'vsf',
  'vtnc',
  'xoxota',
];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '@': 'a',
  $: 's',
};

function collapse(word: string): string {
  return word.replace(/(.)\1+/g, '$1');
}

const PROFANE = new Set(PROFANE_WORDS.map(collapse));

function unleet(token: string): string {
  if (!/[a-z]/.test(token)) return token;
  return token.replace(/[0-9@$]/g, char => LEET[char] ?? char);
}

function isProfane(token: string): boolean {
  const word = collapse(unleet(token));
  if (PROFANE.has(word)) return true;
  return word.length > 2 && word.endsWith('s') && PROFANE.has(word.slice(0, -1));
}

export function hasProfanity(text: string): boolean {
  return normalizeText(text)
    .split(/[^a-z0-9@$]+/)
    .some(token => token.length > 0 && isProfane(token));
}
