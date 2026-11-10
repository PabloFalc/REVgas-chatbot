import { Inject, Injectable } from '@nestjs/common';
import { createLogger } from '../../config/plugins/pino.config';
import { removeCpfMentions, removeCpfs, removeLongDigitRuns } from '../../utils/cpf';
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

type SearchResult =
  | Extract<SearchOutcome, { status: 'ok' }>
  | { status: 'unavailable'; errorName: string };

interface UnknownDetails {
  rejection?: AnswerRejection;
  errorName?: string;
}

function sanitizeQuestion(question: string): string | null {
  const clean = removeLongDigitRuns(removeCpfMentions(removeCpfs(question)))
    .trim()
    .slice(0, MAX_QUESTION_CHARS);
  return /[\p{L}\p{N}]/u.test(clean) ? clean : null;
}

function nameOf(error: unknown): string {
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

    const result = await this.searchSanitized(clean);
    if (result.status === 'ok') return result;
    this.logger.warn(
      { component: 'knowledge', reason: 'unavailable', errorName: result.errorName },
      'Busca na base indisponível',
    );
    return { status: 'unavailable' };
  }

  async answerQuestion(question: string): Promise<KnowledgeAnswer> {
    const clean = sanitizeQuestion(question);
    if (!clean) return this.unknown('no_match', 0);

    const result = await this.searchSanitized(clean);
    if (result.status === 'unavailable') {
      return this.unknown('unavailable', 0, { errorName: result.errorName });
    }
    if (result.chunks.length === 0) return this.unknown('no_match', 0);

    const sources: AnswerSource[] = result.chunks.map((chunk, index) => ({
      ref: `T${index + 1}`,
      title: chunk.title,
      content: chunk.content,
    }));

    let draft: DraftAnswer;
    try {
      draft = await this.answers.draft(clean, sources);
    } catch (error) {
      return this.unknown('unavailable', sources.length, { errorName: nameOf(error) });
    }

    if (draft.answer === null) return this.unknown('not_in_sources', sources.length);

    const checked = checkAnswer({ answer: draft.answer, sources: draft.sources }, sources);
    if (!checked.ok) {
      return this.unknown('rejected', sources.length, { rejection: checked.reason });
    }

    const titles = [...new Set(checked.used.map(source => source.title))];
    this.logger.info(
      { component: 'knowledge', chunks: sources.length, sources: titles },
      'Dúvida respondida',
    );
    return { kind: 'answered', text: checked.text, sources: titles };
  }

  private async searchSanitized(question: string): Promise<SearchResult> {
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
      return { status: 'unavailable', errorName: nameOf(error) };
    }
  }

  private unknown(
    reason: UnknownReason,
    chunks: number,
    details: UnknownDetails = {},
  ): KnowledgeAnswer {
    this.logger.warn({ component: 'knowledge', reason, ...details, chunks }, 'Dúvida sem resposta');
    return { kind: 'unknown', reason };
  }
}
