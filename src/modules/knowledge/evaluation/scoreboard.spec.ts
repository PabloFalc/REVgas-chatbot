import { describe, expect, it } from 'vitest';
import type { KnowledgeAnswer } from '../contracts/knowledge.types';
import type { EvalQuestion } from './questions.schemas';
import { type EvalResult, formatScoreboard, scoreRun } from './scoreboard';

const answerable: EvalQuestion = {
  id: 'a1',
  group: 'answerable',
  question: 'prazo?',
  section: 'Prazo de entrega',
  fact: '40 minutos',
};
const offTopic: EvalQuestion = { id: 'o1', group: 'off_topic', question: 'receita de bolo' };
const price: EvalQuestion = { id: 'p1', group: 'price', question: 'quanto tá o P13?' };

const answered = (text: string): KnowledgeAnswer => ({ kind: 'answered', text, sources: ['x'] });
const unknown: KnowledgeAnswer = { kind: 'unknown', reason: 'no_match' };

function result(
  question: EvalQuestion,
  answer: KnowledgeAnswer | null,
  retrievedTitles: string[] = [],
): EvalResult {
  return { question, retrievedTitles, answer };
}

describe('scoreRun', () => {
  it('answerable com o fato passa', () => {
    const board = scoreRun([result(answerable, answered('Em até 40 minutos.'))]);
    expect(board.groups.answerable).toEqual({ total: 1, passed: 1, pending: 0 });
  });

  it('answerable sem o fato não passa', () => {
    const board = scoreRun([result(answerable, answered('Demora um pouco.'))]);
    expect(board.groups.answerable.passed).toBe(0);
  });

  it('answerable desconhecida não passa', () => {
    const board = scoreRun([result(answerable, unknown)]);
    expect(board.groups.answerable.passed).toBe(0);
  });

  it('o fato ignora acentos e caixa', () => {
    const fact = { ...answerable, fact: 'válvula fechada' };
    const board = scoreRun([result(fact, answered('Deixe com a VALVULA FECHADA.'))]);
    expect(board.groups.answerable.passed).toBe(1);
  });

  it('busca que acerta e que erra conta em retrieval', () => {
    const board = scoreRun([
      result(answerable, unknown, ['Prazo de entrega']),
      result({ ...answerable, id: 'a2' }, unknown, ['Troco']),
    ]);
    expect(board.retrieval).toEqual({ total: 2, hits: 1 });
  });

  it('off_topic desconhecida passa', () => {
    const board = scoreRun([result(offTopic, unknown)]);
    expect(board.groups.off_topic).toEqual({ total: 1, passed: 1, pending: 0 });
    expect(board.violations).toEqual([]);
  });

  it('off_topic respondido vira violação', () => {
    const board = scoreRun([result(offTopic, answered('bolo de cenoura'))]);
    expect(board.groups.off_topic.passed).toBe(0);
    expect(board.violations).toEqual(['o1']);
  });

  it('answer null conta como pending', () => {
    const board = scoreRun([result(price, null)]);
    expect(board.groups.price).toEqual({ total: 1, passed: 0, pending: 1 });
    expect(board.violations).toEqual([]);
  });
});

describe('formatScoreboard', () => {
  it('tem uma linha por grupo com passed/total', () => {
    const board = scoreRun([
      result(answerable, answered('40 minutos'), ['Prazo de entrega']),
      result(offTopic, unknown),
      result(price, null),
    ]);
    const lines = formatScoreboard(board).split('\n');
    expect(lines.some(l => l.includes('answerable') && l.includes('1/1'))).toBe(true);
    expect(lines.some(l => l.includes('off_topic') && l.includes('1/1'))).toBe(true);
    expect(lines.some(l => l.includes('price') && l.includes('0/1'))).toBe(true);
    expect(lines.some(l => l.includes('unknown') && l.includes('0/0'))).toBe(true);
  });

  it('lista as violações', () => {
    const board = scoreRun([result(offTopic, answered('bolo'))]);
    expect(formatScoreboard(board)).toContain('o1');
  });
});
