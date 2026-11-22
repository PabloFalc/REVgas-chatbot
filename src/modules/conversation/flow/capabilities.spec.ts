import { describe, expect, it } from 'vitest';
import { isCapabilitiesQuestion } from './capabilities';

describe('isCapabilitiesQuestion', () => {
  it.each([
    'Certo, quais tipos de dúvidas, pode me resumir quais',
    'quero que voce me resuma quais tipo de dúvidas posso tirar com voce',
    'quais dúvidas posso tirar com você?',
    'o que você sabe responder?',
    'me resume o que você sabe',
    'sobre o que posso perguntar?',
    'que tipo de pergunta vc responde?',
    'quais assuntos vocês atendem?',
  ])('"%s" pergunta o que o bot sabe responder', value => {
    expect(isCapabilitiesQuestion(value)).toBe(true);
  });

  it.each([
    'tenho dúvidas',
    'quais bairros vocês atendem?',
    'o que você sabe sobre vale-gás?',
    'quais dúvidas sobre o P45 vocês respondem?',
    'que tipo de gás vocês vendem?',
    'liste os bairros que vocês atendem',
    'quero 2 botijões',
    '',
  ])('"%s" não é pergunta sobre os assuntos', value => {
    expect(isCapabilitiesQuestion(value)).toBe(false);
  });
});
