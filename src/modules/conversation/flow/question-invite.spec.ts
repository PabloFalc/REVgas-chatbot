import { describe, expect, it } from 'vitest';
import { isQuestionInvite } from './question-invite';

describe('isQuestionInvite', () => {
  it.each([
    'tenho dúvidas',
    'Tenho uma dúvida',
    'tenho umas perguntas',
    'eu tenho algumas dúvidas',
    'tô com uma dúvida',
    'estou com dúvidas',
    'oi, tenho uma dúvida',
    'posso perguntar uma coisa?',
    'posso te fazer uma pergunta?',
    'posso perguntar?',
    'posso tirar uma dúvida?',
    'queria tirar uma dúvida',
    'quero tirar minhas dúvidas',
    'gostaria de fazer uma pergunta',
    'quero que você tire dúvidas comigo',
    'queria que vc tirasse umas dúvidas',
    'quero que voce tire minhas duvidas',
    'me tira uma dúvida?',
    'tira uma dúvida minha',
  ])('"%s" só anuncia a dúvida', text => {
    expect(isQuestionInvite(text)).toBe(true);
  });

  it.each([
    'não quero tirar minhas dúvidas',
    'nao tenho duvidas',
    'tenho uma dúvida: vocês entregam domingo?',
    'tenho dúvida sobre o vale-gás',
    'posso pagar no pix?',
    'quero 2 P13',
    'quero falar com um atendente',
    'dúvidas',
    '',
  ])('"%s" não é só convite', text => {
    expect(isQuestionInvite(text)).toBe(false);
  });
});
