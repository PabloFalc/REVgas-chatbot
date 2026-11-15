import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { closeDatabasePool, db } from '../src/infra/database/drizzle-client';
import { createEmbeddingClient, createLlmClient } from '../src/integrations/llm/llm.factory';
import { resolveEmbeddingConfig } from '../src/integrations/llm/shared/embedding.config';
import { resolveLlmConfig } from '../src/integrations/llm/shared/llm.config';
import { AssistantService } from '../src/modules/assistant/assistant.service';
import type { InterpretContext } from '../src/modules/assistant/contracts/assistant.types';
import { detectEmergency } from '../src/modules/conversation/flow/emergency';
import { routeOfText } from '../src/modules/conversation/flow/route';
import { AnswerGateway } from '../src/modules/knowledge/answer.gateway';
import { EmbeddingGateway } from '../src/modules/knowledge/embedding.gateway';
import { assertSafeForEvaluation } from '../src/modules/knowledge/evaluation/evaluation-safety';
import {
  type EvalGroup,
  type EvalQuestion,
  expectedIntentOf,
  loadEvalQuestions,
  routeMatches,
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
const KNOWLEDGE_GROUPS: readonly EvalGroup[] = [
  'answerable',
  'unknown',
  'off_topic',
  'manipulation',
];
const INTERPRET_CONTEXT: InterpretContext = {
  products: ['P13', 'P45', 'Água 20L'],
  payments: [
    { type: 'PIX', label: 'Pix' },
    { type: 'DINHEIRO', label: 'Dinheiro' },
  ],
};

const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

describe.skipIf(!(env.EMBEDDING_API_KEY ?? env.LLM_API_KEY))('RAG da base de conhecimento', () => {
  let service: KnowledgeService;
  let assistant: AssistantService;
  let questions: EvalQuestion[];

  beforeAll(async () => {
    const liveEnv = { ...env, LLM_MODE: 'live' as const };
    const repository = new KnowledgeRepository(db);
    const embeddings = new EmbeddingGateway(createEmbeddingClient(resolveEmbeddingConfig(liveEnv)));
    const llm = createLlmClient(resolveLlmConfig(liveEnv));
    const answers = new AnswerGateway(llm);
    assistant = new AssistantService(llm);
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

  afterAll(async () => {
    await closeDatabasePool();
  });

  it(
    'responde as perguntas da checagem sem violações',
    async () => {
      const results: EvalResult[] = [];
      let first = true;

      for (const question of questions) {
        if (question.group === 'emergency') {
          results.push({
            question,
            retrievedTitles: [],
            answer: null,
            routedCorrectly: detectEmergency(question.question),
          });
          continue;
        }
        if (!first) await sleep(QUESTION_DELAY_MS);
        first = false;

        if (question.group === 'routing') {
          const route = await routeOfText(question.question, () =>
            assistant.interpret(question.question, INTERPRET_CONTEXT),
          );
          results.push({
            question,
            retrievedTitles: [],
            answer: null,
            routedCorrectly: routeMatches(question, route),
          });
          console.log(`${question.id}: ${route}`);
          continue;
        }
        if (question.group === 'price') {
          const interpreted = await assistant.interpret(question.question, INTERPRET_CONTEXT);
          results.push({
            question,
            retrievedTitles: [],
            answer: null,
            routedCorrectly: interpreted?.intent === expectedIntentOf(question),
          });
          continue;
        }
        if (!KNOWLEDGE_GROUPS.includes(question.group)) {
          results.push({ question, retrievedTitles: [], answer: null });
          continue;
        }

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
