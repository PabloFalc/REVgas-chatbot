import { describe, expect, it } from 'vitest';
import { ANSWER_MAX_LENGTH, checkAnswer } from './answer-checks';
import type { AnswerSource } from './contracts/knowledge.types';

const T1: AnswerSource = {
  ref: 'T1',
  title: 'Bairros atendidos',
  content: 'Entregamos no Jóquei e no Fátima em até 40 minutos.',
};

const T2: AnswerSource = {
  ref: 'T2',
  title: 'Troca do registro',
  content: 'A troca do registro é agendada em até 30 dias.',
};

function check(answer: string, sources = ['T1'], sent = [T1, T2]) {
  return checkAnswer({ answer, sources }, sent);
}

describe('checkAnswer', () => {
  it('resposta fiel passa e devolve o texto sem espaços nas pontas', () => {
    const result = check('  Entregamos no Jóquei e no Fátima.  ');
    expect(result).toEqual({ ok: true, text: 'Entregamos no Jóquei e no Fátima.', used: [T1] });
  });

  it('devolve as fontes citadas na ordem citada e sem repetição', () => {
    const result = check('Entregamos no Jóquei.', ['T2', 'T1', 'T2']);
    expect(result).toMatchObject({ ok: true, used: [T2, T1] });
  });

  it('sem sources → no_sources', () => {
    expect(check('Entregamos no Jóquei.', [])).toEqual({ ok: false, reason: 'no_sources' });
  });

  it("source 'T9' não enviado → unknown_source", () => {
    expect(check('Entregamos no Jóquei.', ['T1', 'T9'])).toEqual({
      ok: false,
      reason: 'unknown_source',
    });
  });

  it.each(['Custa R$ 120', 'sai por 120 reais', 'são 50 centavos a mais'])('%s → money', answer => {
    expect(check(answer)).toEqual({ ok: false, reason: 'money' });
  });

  it.each(['10% de desconto', 'dez por cento', 'cinco porcento'])('%s → percent', answer => {
    expect(check(answer)).toEqual({ ok: false, reason: 'percent' });
  });

  it("'em até 40 minutos' → ok", () => {
    expect(check('Entregamos em até 40 minutos.')).toMatchObject({ ok: true });
  });

  it("'em até 30 minutos' → number_not_in_sources", () => {
    expect(check('Entregamos em até 30 minutos.')).toEqual({
      ok: false,
      reason: 'number_not_in_sources',
    });
  });

  it("'às 8h' sem 8 nos trechos → number_not_in_sources", () => {
    expect(check('Começamos às 8h.')).toEqual({ ok: false, reason: 'number_not_in_sources' });
  });

  it("'08' casa com 8 do trecho", () => {
    const T3: AnswerSource = { ref: 'T3', title: 'Rotas', content: 'Saem 8 caminhões por dia.' };
    expect(check('Saem 08 caminhões por dia.', ['T3'], [T3])).toMatchObject({ ok: true });
  });

  it('número do título do trecho citado é aceito', () => {
    const T3: AnswerSource = { ref: 'T3', title: 'Botijão P13', content: 'É o mais vendido.' };
    expect(check('O P13 é o mais vendido.', ['T3'], [T3])).toMatchObject({ ok: true });
  });

  it('\'em duas horas\' sem "duas"/"2" nos trechos → number_not_in_sources', () => {
    expect(check('Entregamos em duas horas.')).toEqual({
      ok: false,
      reason: 'number_not_in_sources',
    });
  });

  it('\'em duas horas\' com "duas" no trecho → ok', () => {
    const T3: AnswerSource = {
      ref: 'T3',
      title: 'Prazo',
      content: 'A entrega leva até duas horas.',
    };
    expect(check('Entregamos em até duas horas.', ['T3'], [T3])).toMatchObject({ ok: true });
  });

  it("'três' com acento casa com 'tres' do trecho", () => {
    const T3: AnswerSource = { ref: 'T3', title: 'Rotas', content: 'Temos tres rotas.' };
    expect(check('Temos três rotas.', ['T3'], [T3])).toMatchObject({ ok: true });
  });

  it("'um' e 'uma' não contam como número", () => {
    expect(check('Entregamos em uma rota só, um caminhão.')).toMatchObject({ ok: true });
  });

  it('número só em trecho não citado → number_not_in_sources', () => {
    expect(check('A troca é agendada em até 30 dias.', ['T1'])).toEqual({
      ok: false,
      reason: 'number_not_in_sources',
    });
  });

  it("'   ' → empty", () => {
    expect(check('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('601 caracteres → too_long', () => {
    expect(ANSWER_MAX_LENGTH).toBe(600);
    expect(check('a'.repeat(601))).toEqual({ ok: false, reason: 'too_long' });
    expect(check('a'.repeat(600))).toMatchObject({ ok: true });
  });

  it('vazio vem antes de no_sources e too_long antes de money', () => {
    expect(check('  ', [])).toEqual({ ok: false, reason: 'empty' });
    expect(check(`R$ ${'a'.repeat(600)}`)).toEqual({ ok: false, reason: 'too_long' });
  });
});
