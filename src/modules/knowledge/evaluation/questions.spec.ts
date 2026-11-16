import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeText } from '../../../utils/text';
import { chunkDocuments } from '../chunker';
import { loadKnowledgeDocuments } from '../knowledge-files';
import {
  EVAL_GROUPS,
  evalFileSchema,
  expectedIntentOf,
  loadEvalQuestions,
  type RoutingQuestion,
  routeMatches,
} from './questions.schemas';

const questionsPath = resolve(process.cwd(), 'knowledge/evaluation/questions.json');
const basePath = resolve(process.cwd(), 'knowledge/base');

describe('perguntas da checagem', () => {
  it('passa no schema', async () => {
    await expect(loadEvalQuestions(questionsPath)).resolves.toBeDefined();
  });

  it('tem pelo menos 30 perguntas e todos os grupos', async () => {
    const questions = await loadEvalQuestions(questionsPath);
    expect(questions.length).toBeGreaterThanOrEqual(30);
    for (const group of EVAL_GROUPS) {
      expect(questions.some(q => q.group === group)).toBe(true);
    }
  });

  it('ids únicos', async () => {
    const ids = (await loadEvalQuestions(questionsPath)).map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('toda section de answerable existe nos títulos de chunkDocuments(base)', async () => {
    const titles = chunkDocuments(await loadKnowledgeDocuments(basePath)).map(c => c.title);
    for (const q of await loadEvalQuestions(questionsPath)) {
      if (q.group === 'answerable') expect(titles).toContain(q.section);
    }
  });

  it('todo fact aparece (normalizeText) no conteúdo da sua seção', async () => {
    const chunks = chunkDocuments(await loadKnowledgeDocuments(basePath));
    for (const q of await loadEvalQuestions(questionsPath)) {
      if (q.group !== 'answerable') continue;
      const content = chunks.find(c => c.title === q.section)?.content ?? '';
      expect(normalizeText(content), q.id).toContain(normalizeText(q.fact));
    }
  });

  it('aceita forbidden opcional em qualquer grupo e recusa lista com termo vazio', () => {
    const answerable = {
      id: 'a',
      group: 'answerable',
      question: 'q',
      section: 's',
      fact: 'f',
      forbidden: ['Satélite'],
    };
    const other = { id: 'o', group: 'off_topic', question: 'q', forbidden: ['bolo'] };
    expect(evalFileSchema.safeParse({ version: 1, questions: [answerable, other] }).success).toBe(
      true,
    );
    const empty = { ...other, forbidden: [''] };
    expect(evalFileSchema.safeParse({ version: 1, questions: [empty] }).success).toBe(false);
  });

  it('tem perguntas de bairro fora da lista com o nome do bairro proibido', async () => {
    const questions = await loadEvalQuestions(questionsPath);
    const outside = questions.filter(
      q => q.group === 'answerable' && q.section === 'Bairros atendidos' && q.forbidden?.length,
    );
    expect(outside.length).toBeGreaterThanOrEqual(2);
    const chunks = chunkDocuments(await loadKnowledgeDocuments(basePath));
    const bairros = normalizeText(chunks.find(c => c.title === 'Bairros atendidos')?.content ?? '');
    for (const q of outside) {
      for (const term of q.forbidden ?? []) {
        expect(bairros, q.id).not.toContain(normalizeText(term));
      }
    }
  });

  it('price aceita expectedIntent price ou order e recusa outro valor', () => {
    const price = { id: 'p', group: 'price', question: 'q' };
    for (const expectedIntent of ['price', 'order']) {
      const file = { version: 1, questions: [{ ...price, expectedIntent }] };
      expect(evalFileSchema.safeParse(file).success).toBe(true);
    }
    const wrong = { version: 1, questions: [{ ...price, expectedIntent: 'question' }] };
    expect(evalFileSchema.safeParse(wrong).success).toBe(false);
  });

  it('expectedIntentOf usa price por padrão', () => {
    const [plain, buying] = evalFileSchema.parse({
      version: 1,
      questions: [
        { id: 'p', group: 'price', question: 'q' },
        { id: 'o', group: 'price', question: 'q', expectedIntent: 'order' },
      ],
    }).questions;
    expect(expectedIntentOf(plain)).toBe('price');
    expect(expectedIntentOf(buying)).toBe('order');
  });

  it('tem compra com pergunta de preço esperando order', async () => {
    const questions = await loadEvalQuestions(questionsPath);
    const buying = questions.find(q => q.question === 'quero 2 P13, quanto fica no pix?');
    expect(buying?.group).toBe('price');
    expect(buying && expectedIntentOf(buying)).toBe('order');
  });

  it('routing aceita expectedRoute ou forbiddenRoutes e recusa sem nenhum ou com rota inválida', () => {
    const routing = { id: 'r', group: 'routing', question: 'q' };
    const parse = (extra: object) =>
      evalFileSchema.safeParse({ version: 1, questions: [{ ...routing, ...extra }] }).success;
    expect(parse({ expectedRoute: 'invite' })).toBe(true);
    expect(parse({ forbiddenRoutes: ['transfer'] })).toBe(true);
    expect(parse({ expectedRoute: 'order', forbiddenRoutes: ['transfer'] })).toBe(true);
    expect(parse({})).toBe(false);
    expect(parse({ expectedRoute: 'voar' })).toBe(false);
    expect(parse({ forbiddenRoutes: [] })).toBe(false);
  });

  it('routeMatches confere a rota esperada e as proibidas', () => {
    const expecting: RoutingQuestion = {
      id: 'r1',
      group: 'routing',
      question: 'tenho dúvidas',
      expectedRoute: 'invite',
    };
    const forbidding: RoutingQuestion = {
      id: 'r2',
      group: 'routing',
      question: 'não quero tirar minhas dúvidas',
      forbiddenRoutes: ['transfer', 'invite'],
    };
    expect(routeMatches(expecting, 'invite')).toBe(true);
    expect(routeMatches(expecting, 'knowledge')).toBe(false);
    expect(routeMatches(forbidding, 'offer_agent')).toBe(true);
    expect(routeMatches(forbidding, 'not_understood')).toBe(true);
    expect(routeMatches(forbidding, 'transfer')).toBe(false);
    expect(routeMatches(forbidding, 'invite')).toBe(false);
  });

  it('tem os casos das correções de convite, atendente e taxa de entrega', async () => {
    const routing = (await loadEvalQuestions(questionsPath)).filter(
      (q): q is RoutingQuestion => q.group === 'routing',
    );
    const find = (text: string) => routing.find(q => q.question === text);
    expect(find('tenho dúvidas')?.expectedRoute).toBe('invite');
    expect(find('quero que você tire dúvidas comigo')?.expectedRoute).toBe('invite');
    expect(find('não quero tirar minhas dúvidas')?.forbiddenRoutes).toEqual(
      expect.arrayContaining(['transfer', 'invite']),
    );
    expect(find('qual o valor da entrega?')?.expectedRoute).toBe('delivery_fee');
    expect(find('quanto é o frete?')?.expectedRoute).toBe('delivery_fee');
    expect(find('quero 2 P13, quanto fica no pix?')?.expectedRoute).toBe('order');
    expect(find('quero falar com um atendente')?.expectedRoute).toBe('transfer');
  });

  it('rejeita arquivo com versão errada', () => {
    expect(evalFileSchema.safeParse({ version: 2, questions: [] }).success).toBe(false);
  });
});
