import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { db } from '../src/infra/database/drizzle-client';
import { createEmbeddingClient, createLlmClient } from '../src/integrations/llm/llm.factory';
import { resolveEmbeddingConfig } from '../src/integrations/llm/shared/embedding.config';
import { resolveLlmConfig } from '../src/integrations/llm/shared/llm.config';
import { AnswerGateway } from '../src/modules/knowledge/answer.gateway';
import { EmbeddingGateway } from '../src/modules/knowledge/embedding.gateway';
import { assertSafeForEvaluation } from '../src/modules/knowledge/evaluation/evaluation-safety';
import {
  type EvalGroup,
  type EvalQuestion,
  loadEvalQuestions,
} from '../src/modules/knowledge/evaluation/questions.schemas';
import {
  type EvalResult,
  formatScoreboard,
  scoreRun,
} from '../src/modules/knowledge/evaluation/scoreboard';
import { resolveKnowledgeConfig } from '../src/modules/knowledge/knowledge.config';
import { KnowledgeRepository } from '../src/modules/knowledge/knowledge.repository';
import { KnowledgeService } from '../src/modules/knowledge/knowledge.service';
import { loadKnowledgeDocuments } from '../src/modules/knowledge/knowledge-files';
import { KnowledgeIngestService } from '../src/modules/knowledge/knowledge-ingest.service';

const QUESTION_DELAY_MS = 4000;
const INGEST_TIMEOUT_MS = 120_000;
const RUN_TIMEOUT_MS = 25 * 60_000;
const STAGE_A_GROUPS: readonly EvalGroup[] = ['answerable', 'unknown', 'off_topic', 'manipulation'];

const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

describe.skipIf(!(env.EMBEDDING_API_KEY ?? env.LLM_API_KEY))('RAG da base de conhecimento', () => {
  let service: KnowledgeService;
  let questions: EvalQuestion[];

  beforeAll(async () => {
    const liveEnv = { ...env, LLM_MODE: 'live' as const };
    const repository = new KnowledgeRepository(db);
    const embeddings = new EmbeddingGateway(createEmbeddingClient(resolveEmbeddingConfig(liveEnv)));
    const answers = new AnswerGateway(createLlmClient(resolveLlmConfig(liveEnv)));
    service = new KnowledgeService(repository, embeddings, answers, resolveKnowledgeConfig(env));

    const documents = await loadKnowledgeDocuments(resolve(process.cwd(), 'knowledge/base'));
    const indexKeys = (await repository.listIndex()).map(item => item.key);
    assertSafeForEvaluation(
      indexKeys,
      documents.map(document => document.source),
      env.NODE_ENV,
    );
    await new KnowledgeIngestService(repository, embeddings).ingest(documents);
    questions = await loadEvalQuestions(
      resolve(process.cwd(), 'knowledge/evaluation/questions.json'),
    );
  }, INGEST_TIMEOUT_MS);

  it(
    'responde as perguntas da checagem sem violações',
    async () => {
      const results: EvalResult[] = [];
      let first = true;

      for (const question of questions) {
        if (!STAGE_A_GROUPS.includes(question.group)) {
          results.push({ question, retrievedTitles: [], answer: null });
          continue;
        }
        if (!first) await sleep(QUESTION_DELAY_MS);
        first = false;

        const outcome = await service.search(question.question);
        const retrievedTitles =
          outcome.status === 'ok' ? outcome.chunks.map(chunk => chunk.title) : [];
        const answer = await service.answerQuestion(question.question);
        results.push({ question, retrievedTitles, answer });
      }

      const board = scoreRun(results);
      console.log(`\n${formatScoreboard(board)}\n`);
      expect(board.violations).toEqual([]);
    },
    RUN_TIMEOUT_MS,
  );
});
