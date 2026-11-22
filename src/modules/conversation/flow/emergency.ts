import { normalizeText } from 'src/utils/text';

export const EMERGENCY_PHRASES = [
  'vazamento',
  'vazando',
  'vazou',
  'vaza',
  'cheiro de gas',
  'cheirando gas',
  'cheirando a gas',
  'cheiro forte de gas',
  'fedor de gas',
  'gas escapando',
  'escapando gas',
];

const STANDALONE_LEAK_WORDS = [
  'vazamento',
  'vazamentos',
  'vasamento',
  'vazamneto',
  'vazando',
  'vasando',
  'vazou',
  'vaza',
];

const GAS_WORDS = ['gas', 'gaz', 'glp', 'botijao', 'botijoes'];
const EMPTY_WORDS = ['vazio', 'vazia', 'vazios', 'vazias'];
const LEAK_PREFIXES = ['escap', 'saind', 'vaz', 'cheir', 'fedor', 'feden'];
const PROXIMITY = 4;

function tokensOf(value: string): string[] {
  return value
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function isLeakToken(token: string): boolean {
  if (EMPTY_WORDS.includes(token)) return false;
  return LEAK_PREFIXES.some(prefix => token.startsWith(prefix));
}

function gasNearLeak(tokens: string[]): boolean {
  return tokens.some((token, index) => {
    if (!GAS_WORDS.includes(token)) return false;
    const from = Math.max(0, index - PROXIMITY);
    return tokens.slice(from, index + PROXIMITY + 1).some(isLeakToken);
  });
}

export function detectEmergency(text: string): boolean {
  const tokens = tokensOf(normalizeText(text));
  const padded = ` ${tokens.join(' ')} `;
  if (EMERGENCY_PHRASES.some(phrase => padded.includes(` ${phrase} `))) return true;
  if (tokens.some(token => STANDALONE_LEAK_WORDS.includes(token))) return true;
  return gasNearLeak(tokens);
}
