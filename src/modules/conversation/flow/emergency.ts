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

function tokensOf(value: string): string {
  return ` ${value.replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

export function detectEmergency(text: string): boolean {
  const padded = tokensOf(normalizeText(text));
  return EMERGENCY_PHRASES.some(phrase => padded.includes(` ${phrase} `));
}
