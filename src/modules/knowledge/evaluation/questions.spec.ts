import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeText } from '../../../utils/text';
import { chunkDocuments } from '../chunker';
import { loadKnowledgeDocuments } from '../knowledge-files';
import { EVAL_GROUPS, evalFileSchema, loadEvalQuestions } from './questions.schemas';

const questionsPath = resolve(process.cwd(), 'knowledge/evaluation/questions.json');
const basePath = resolve(process.cwd(), 'knowledge/base');

describe('perguntas da checagem', () => {
  it('passa no schema', async () => {
    await expect(loadEvalQuestions(questionsPath)).resolves.toBeDefined();
  });

  it('tem pelo menos 30 perguntas e todos os 6 grupos', async () => {
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

  it('rejeita arquivo com versão errada', () => {
    expect(evalFileSchema.safeParse({ version: 2, questions: [] }).success).toBe(false);
  });
});
