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

  it('rejeita arquivo com versão errada', () => {
    expect(evalFileSchema.safeParse({ version: 2, questions: [] }).success).toBe(false);
  });
});
