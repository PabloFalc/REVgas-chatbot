import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmRateLimitedError, LlmUnavailableError } from '../../core/erros/llm/llm.errors';
import { FakeEmbeddingClient } from '../../integrations/llm/fake-embedding.client';
import { FakeLlmClient } from '../../integrations/llm/fake-llm.client';
import { AnswerGateway } from './answer.gateway';
import type { Candidate } from './contracts/knowledge.types';
import { EmbeddingGateway } from './embedding.gateway';
import { CANDIDATES_PER_LIST } from './fuse';
import type { KnowledgeConfig } from './knowledge.config';
import type { CandidateQuery, KnowledgeRepository } from './knowledge.repository';
import { KnowledgeService } from './knowledge.service';

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('../../config/plugins/pino.config', () => ({
  createLogger: () => logger,
}));

const CONFIG: KnowledgeConfig = {
  dir: 'docs/knowledge',
  topK: 3,
  minSimilarity: 0.7,
  minSimilarityWithText: 0.6,
};

const BAIRROS: Candidate = {
  id: 'c1',
  source: 'entrega.md',
  title: 'Bairros atendidos',
  content: 'Entregamos no Jóquei e no Fátima em até 40 minutos.',
  similarity: 0.85,
};

const REGISTRO: Candidate = {
  id: 'c2',
  source: 'servicos.md',
  title: 'Troca do registro',
  content: 'A troca do registro é agendada.',
  similarity: 0.75,
};

class FakeRepository {
  queries: CandidateQuery[] = [];
  byVector: Candidate[] = [BAIRROS, REGISTRO];
  byText: Candidate[] = [];
  error?: Error;

  async findCandidates(query: CandidateQuery) {
    this.queries.push(query);
    if (this.error) throw this.error;
    return { byVector: this.byVector, byText: this.byText };
  }
}

const QUESTION = 'vocês entregam no Jóquei?';

describe('KnowledgeService', () => {
  let repo: FakeRepository;
  let embeddings: FakeEmbeddingClient;
  let llm: FakeLlmClient;
  let service: KnowledgeService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new FakeRepository();
    embeddings = new FakeEmbeddingClient();
    llm = new FakeLlmClient();
    service = new KnowledgeService(
      repo as unknown as KnowledgeRepository,
      new EmbeddingGateway(embeddings),
      new AnswerGateway(llm),
      CONFIG,
    );
  });

  function warnCalls() {
    return logger.warn.mock.calls.map(([obj]) => obj as Record<string, unknown>);
  }

  function allLogs() {
    return JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls]);
  }

  describe('answerQuestion', () => {
    it('nada acima do corte → unknown no_match e a IA não é chamada', async () => {
      repo.byVector = [{ ...BAIRROS, similarity: 0.5 }];
      await expect(service.answerQuestion(QUESTION)).resolves.toEqual({
        kind: 'unknown',
        reason: 'no_match',
      });
      expect(llm.calls).toEqual([]);
      expect(warnCalls()).toContainEqual({ component: 'knowledge', reason: 'no_match', chunks: 0 });
    });

    it("embedding falha → unknown unavailable, IA não chamada, log warn reason 'unavailable'", async () => {
      embeddings.queueError(new LlmUnavailableError('timeout'));
      await expect(service.answerQuestion(QUESTION)).resolves.toEqual({
        kind: 'unknown',
        reason: 'unavailable',
      });
      expect(llm.calls).toEqual([]);
      expect(repo.queries).toEqual([]);
      expect(warnCalls()).toContainEqual(
        expect.objectContaining({ component: 'knowledge', reason: 'unavailable' }),
      );
    });

    it('repositório lança → unknown unavailable', async () => {
      repo.error = new Error(`Failed query: params ${QUESTION}`);
      await expect(service.answerQuestion(QUESTION)).resolves.toEqual({
        kind: 'unknown',
        reason: 'unavailable',
      });
      expect(llm.calls).toEqual([]);
      expect(allLogs()).not.toContain('Jóquei');
    });

    it('IA devolve answer null → not_in_sources', async () => {
      llm.queueObject({ answer: null, sources: [] });
      await expect(service.answerQuestion(QUESTION)).resolves.toEqual({
        kind: 'unknown',
        reason: 'not_in_sources',
      });
      expect(warnCalls()).toContainEqual({
        component: 'knowledge',
        reason: 'not_in_sources',
        chunks: 2,
      });
    });

    it('IA falha (LlmRateLimitedError) → unavailable', async () => {
      llm.queueError(new LlmRateLimitedError('limite'));
      await expect(service.answerQuestion(QUESTION)).resolves.toEqual({
        kind: 'unknown',
        reason: 'unavailable',
      });
      expect(warnCalls()).toContainEqual({
        component: 'knowledge',
        reason: 'unavailable',
        chunks: 2,
      });
    });

    it('erro inesperado da IA não escapa → unavailable', async () => {
      llm.respondWith(() => {
        throw new Error('boom');
      });
      await expect(service.answerQuestion(QUESTION)).resolves.toEqual({
        kind: 'unknown',
        reason: 'unavailable',
      });
    });

    it("resposta com R$ → rejected e log warn com rejection 'money'", async () => {
      llm.queueObject({ answer: 'A entrega custa R$ 5 no Jóquei.', sources: ['T1'] });
      await expect(service.answerQuestion(QUESTION)).resolves.toEqual({
        kind: 'unknown',
        reason: 'rejected',
      });
      expect(warnCalls()).toContainEqual({
        component: 'knowledge',
        reason: 'rejected',
        rejection: 'money',
        chunks: 2,
      });
      expect(allLogs()).not.toContain(QUESTION);
      expect(allLogs()).not.toContain('custa');
    });

    it('resposta boa → answered com o texto e os títulos citados', async () => {
      llm.queueObject({
        answer: ' Sim, entregamos no Jóquei em até 40 minutos. ',
        sources: ['T1'],
      });
      await expect(service.answerQuestion(QUESTION)).resolves.toEqual({
        kind: 'answered',
        text: 'Sim, entregamos no Jóquei em até 40 minutos.',
        sources: ['Bairros atendidos'],
      });
      expect(logger.info).toHaveBeenCalledWith(
        { component: 'knowledge', chunks: 2, sources: ['Bairros atendidos'] },
        'Dúvida respondida',
      );
      expect(allLogs()).not.toContain(QUESTION);
      expect(allLogs()).not.toContain('40 minutos');
    });

    it('manda os trechos como T1…Tn na ordem do ranking', async () => {
      llm.queueObject({ answer: null, sources: [] });
      await service.answerQuestion(QUESTION);
      const system = llm.calls[0].messages[0].content;
      expect(system.indexOf('<trecho id="T1" titulo="Bairros atendidos">')).toBeGreaterThan(-1);
      expect(system.indexOf('<trecho id="T2" titulo="Troca do registro">')).toBeGreaterThan(
        system.indexOf('<trecho id="T1"'),
      );
      expect(llm.calls[0].messages[1]).toEqual({ role: 'user', content: QUESTION });
    });

    it('CPF da pergunta não vai ao embedding nem ao prompt', async () => {
      llm.queueObject({ answer: null, sources: [] });
      await service.answerQuestion('meu cpf 123.456.789-09, vocês entregam no Jóquei?');
      expect(embeddings.calls).toHaveLength(1);
      expect(llm.calls).toHaveLength(1);
      expect(JSON.stringify(embeddings.calls)).not.toContain('123');
      expect(JSON.stringify(llm.calls)).not.toContain('123');
      expect(JSON.stringify(repo.queries.map(q => q.textQuery))).not.toContain('123');
    });

    it.each([
      ['vazia', ''],
      ['só espaços', '   '],
      ["só '?'", '?'],
      ['só CPF', '123.456.789-09'],
    ])('pergunta %s → no_match sem nenhuma chamada', async (_label, question) => {
      await expect(service.answerQuestion(question)).resolves.toEqual({
        kind: 'unknown',
        reason: 'no_match',
      });
      expect(embeddings.calls).toEqual([]);
      expect(repo.queries).toEqual([]);
      expect(llm.calls).toEqual([]);
    });

    it('pergunta maior que 500 caracteres é cortada antes do embedding', async () => {
      llm.queueObject({ answer: null, sources: [] });
      const long = 'entregam '.repeat(100);
      await service.answerQuestion(long);
      expect(embeddings.calls[0].input).toEqual([long.trim().slice(0, 500)]);
      expect(llm.calls[0].messages[1].content).toHaveLength(500);
    });
  });

  describe('search', () => {
    it("embeda com operation 'kb-search' e devolve os trechos fundidos", async () => {
      const outcome = await service.search(QUESTION);
      expect(embeddings.calls).toEqual([{ operation: 'kb-search', input: [QUESTION] }]);
      expect(outcome).toMatchObject({ status: 'ok' });
      if (outcome.status !== 'ok') throw new Error('esperava ok');
      expect(outcome.chunks.map(chunk => chunk.title)).toEqual([
        'Bairros atendidos',
        'Troca do registro',
      ]);
    });

    it('manda o vetor, a textQuery e o modelo do embedding ao repositório', async () => {
      await service.search(QUESTION);
      expect(repo.queries).toEqual([
        {
          embedding: embeddings.vectorFor(QUESTION),
          textQuery: 'entregam | joquei',
          model: 'fake',
          limit: CANDIDATES_PER_LIST,
        },
      ]);
    });

    it('search passa textQuery null quando a pergunta não tem termo útil e limit CANDIDATES_PER_LIST', async () => {
      await service.search('oi, bom dia');
      expect(repo.queries).toHaveLength(1);
      expect(repo.queries[0]).toMatchObject({ textQuery: null, limit: CANDIDATES_PER_LIST });
    });

    it('falha do repositório → unavailable', async () => {
      repo.error = new Error('db fora');
      await expect(service.search(QUESTION)).resolves.toEqual({ status: 'unavailable' });
      expect(warnCalls()).toContainEqual(
        expect.objectContaining({ component: 'knowledge', reason: 'unavailable' }),
      );
    });

    it('falha do embedding → unavailable', async () => {
      embeddings.queueError(new LlmUnavailableError('timeout'));
      await expect(service.search(QUESTION)).resolves.toEqual({ status: 'unavailable' });
    });

    it('limpa CPF e pergunta sem termo vira lista vazia sem chamadas', async () => {
      await expect(service.search('123.456.789-09 ?')).resolves.toEqual({
        status: 'ok',
        chunks: [],
      });
      expect(embeddings.calls).toEqual([]);
      expect(repo.queries).toEqual([]);
    });

    it('limpa CPF antes de embedar', async () => {
      await service.search('cpf 123.456.789-09 entregam no Jóquei');
      expect(JSON.stringify(embeddings.calls)).not.toContain('123');
      expect(JSON.stringify(repo.queries.map(q => q.textQuery))).not.toContain('123');
    });
  });
});
