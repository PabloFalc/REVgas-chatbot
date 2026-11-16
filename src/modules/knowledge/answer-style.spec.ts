import { describe, expect, it } from 'vitest';
import { answerStyleOf } from './answer-style';

describe('answerStyleOf', () => {
  it.each([
    'liste os bairros que vocês atendem',
    'me lista as regras de troca',
    'me resume como funciona a entrega',
    'faz um resumo da troca de botijão',
    'me explica em tópicos',
    'como pedir, passo a passo',
    'qual a diferença entre P13 e P45?',
    'compara o P13 com o P45',
    'o que eu preciso saber antes de pedir?',
    'me conta tudo sobre entrega',
    'quero saber tudo sobre o vale-gás',
    'me explica com detalhes a garantia',
  ])('"%s" é pedido amplo', question => {
    expect(answerStyleOf(question)).toBe('broad');
  });

  it.each([
    'vocês entregam no Mocambinho?',
    'aceitam vale gás?',
    'quanto tempo demora a entrega?',
    'tem lista de espera?',
  ])('"%s" é pergunta direta', question => {
    expect(answerStyleOf(question)).toBe('focused');
  });
});
