import { Inject, Injectable } from '@nestjs/common';
import { createLogger } from '../../config/plugins/pino.config';
import { LlmError } from '../../core/erros/llm/llm.errors';
import { removeCpfs } from '../../utils/cpf';
import { AnswerGateway } from './answer.gateway';
import { checkAnswer } from './answer-checks';
import type {
  AnswerRejection,
  AnswerSource,
  DraftAnswer,
  KnowledgeAnswer,
  SearchOutcome,
} from './contracts/knowledge.types';
import { EmbeddingGateway } from './embedding.gateway';
import { CANDIDATES_PER_LIST, fuseCandidates } from './fuse';
import { KNOWLEDGE_CONFIG, type KnowledgeConfig } from './knowledge.config';
import { KnowledgeRepository } from './knowledge.repository';
import { MAX_QUESTION_CHARS, toTextQuery } from './search-query';

const SEARCH_OPERATION = 'kb-search';

type UnknownReason = Extract<KnowledgeAnswer, { kind: 'unknown' }>['reason'];

function sanitizeQuestion(question: string): string | null {
  const clean = removeCpfs(question).trim().slice(0, MAX_QUESTION_CHARS);
  return /[\p{L}\p{N}]/u.test(clean) ? clean : null;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = createLogger('Knowledge');

  constructor(
    private readonly repository: KnowledgeRepository,
    private readonly embeddings: EmbeddingGateway,
    private readonly answers: AnswerGateway,
    @Inject(KNOWLEDGE_CONFIG) private readonly config: KnowledgeConfig,
  ) {}

  async search(question: string): Promise<SearchOutcome> {
    const clean = sanitizeQuestion(question);
    if (!clean) return { status: 'ok', chunks: [] };
    return this.searchSanitized(clean);
  }

  async answerQuestion(question: string): Promise<KnowledgeAnswer> {
    const clean = sanitizeQuestion(question);
    if (!clean) return this.unknown('no_match', 0);

    const outcome = await this.searchSanitized(clean);
    if (outcome.status === 'unavailable') return this.unknown('unavailable', 0);
    if (outcome.chunks.length === 0) return this.unknown('no_match', 0);

    const sources: AnswerSource[] = outcome.chunks.map((chunk, index) => ({
      ref: `T${index + 1}`,
      title: chunk.title,
      content: chunk.content,
    }));

    let draft: DraftAnswer;
    try {
      draft = await this.answers.draft(clean, sources);
    } catch (error) {
      if (!(error instanceof LlmError)) {
        this.logger.warn(
          { component: 'knowledge', error: errorName(error) },
          'Falha inesperada ao gerar a resposta da dúvida',
        );
      }
      return this.unknown('unavailable', sources.length);
    }

    if (draft.answer === null) return this.unknown('not_in_sources', sources.length);

    const checked = checkAnswer({ answer: draft.answer, sources: draft.sources }, sources);
    if (!checked.ok) return this.unknown('rejected', sources.length, checked.reason);

    const titles = checked.used.map(source => source.title);
    this.logger.info(
      { component: 'knowledge', chunks: sources.length, sources: titles },
      'Dúvida respondida',
    );
    return { kind: 'answered', text: checked.text, sources: titles };
  }

  private async searchSanitized(question: string): Promise<SearchOutcome> {
    try {
      const [embedding] = await this.embeddings.embed([question], SEARCH_OPERATION);
      const { byVector, byText } = await this.repository.findCandidates({
        embedding,
        textQuery: toTextQuery(question),
        model: this.embeddings.model,
        limit: CANDIDATES_PER_LIST,
      });
      return { status: 'ok', chunks: fuseCandidates(byVector, byText, this.config) };
    } catch (error) {
      this.logger.warn(
        { component: 'knowledge', reason: 'unavailable', error: errorName(error) },
        'Busca na base indisponível',
      );
      return { status: 'unavailable' };
    }
  }

  private unknown(
    reason: UnknownReason,
    chunks: number,
    rejection?: AnswerRejection,
  ): KnowledgeAnswer {
    this.logger.warn(
      { component: 'knowledge', reason, ...(rejection ? { rejection } : {}), chunks },
      'Dúvida sem resposta',
    );
    return { kind: 'unknown', reason };
  }
}
