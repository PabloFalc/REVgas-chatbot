import { Inject, Injectable } from '@nestjs/common';
import { createLogger } from '../../config/plugins/pino.config';
import { removeLongDigitRuns } from '../../utils/cpf';
import { PII_MARKER, sanitizeForLlm } from '../../utils/pii';
import { AnswerGateway } from './answer.gateway';
import { ANSWER_MAX_LENGTH, BROAD_ANSWER_MAX_LENGTH, checkAnswer } from './answer-checks';
import { answerStyleOf } from './answer-style';
import type {
  AnswerRejection,
  AnswerSource,
  AnswerStyle,
  DraftAnswer,
  KnowledgeAnswer,
  SearchOutcome,
} from './contracts/knowledge.types';
import { EmbeddingGateway } from './embedding.gateway';
import { CANDIDATES_PER_LIST, fuseCandidates } from './fuse';
import { KNOWLEDGE_CONFIG, type KnowledgeConfig } from './knowledge.config';
import { KnowledgeRepository } from './knowledge.repository';
import { MAX_QUESTION_CHARS } from './search-query';

export const FULL_BASE_CHUNKS = 20;
export const BROAD_TOP_K = 8;

const SEARCH_OPERATION = 'kb-search';
const PART_SUFFIX = /\s*\(parte \d+\)$/;
const MAX_LENGTH: Record<AnswerStyle, number> = {
  focused: ANSWER_MAX_LENGTH,
  broad: BROAD_ANSWER_MAX_LENGTH,
};

type UnknownReason = Extract<KnowledgeAnswer, { kind: 'unknown' }>['reason'];

type SearchResult =
  | Extract<SearchOutcome, { status: 'ok' }>
  | { status: 'index_empty' }
  | { status: 'unavailable'; errorName: string };

type Retrieved =
  | { status: 'ok'; chunks: { title: string; content: string }[] }
  | Exclude<SearchResult, { status: 'ok' }>;

type LoggedReason = UnknownReason | 'index_empty';

interface UnknownDetails {
  rejection?: AnswerRejection;
  errorName?: string;
}

function sanitizeQuestion(question: string): string | null {
  const clean = removeLongDigitRuns(sanitizeForLlm(question)).trim().slice(0, MAX_QUESTION_CHARS);
  return /[\p{L}\p{N}]/u.test(clean.replace(PII_MARKER, '')) ? clean : null;
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
    if (result.status === 'index_empty') {
      this.logger.warn({ component: 'knowledge', reason: 'index_empty' }, 'Base sem trechos');
      return { status: 'ok', chunks: [] };
    }
    this.logger.warn(
      { component: 'knowledge', reason: 'unavailable', errorName: result.errorName },
      'Busca na base indisponível',
    );
    return { status: 'unavailable' };
  }

  async topics(): Promise<string[]> {
    try {
      const titles = await this.repository.listTitles(this.embeddings.model);
      return [...new Set(titles.map(title => title.replace(PART_SUFFIX, '')))];
    } catch (error) {
      this.logger.warn(
        { component: 'knowledge', reason: 'unavailable', errorName: nameOf(error) },
        'Assuntos da base indisponíveis',
      );
      return [];
    }
  }

  async answerQuestion(question: string): Promise<KnowledgeAnswer> {
    const clean = sanitizeQuestion(question);
    if (!clean) return this.unknown('no_match', 0);

    const style = answerStyleOf(clean);
    const result = await this.retrieve(clean, style);
    if (result.status === 'unavailable') {
      return this.unknown('unavailable', 0, { errorName: result.errorName });
    }
    if (result.status === 'index_empty') return this.unknown('no_match', 0, {}, 'index_empty');
    if (result.chunks.length === 0) return this.unknown('no_match', 0);

    const sources: AnswerSource[] = result.chunks.map((chunk, index) => ({
      ref: `T${index + 1}`,
      title: chunk.title,
      content: chunk.content,
    }));

    let draft: DraftAnswer;
    try {
      draft = await this.answers.draft(clean, sources, style);
    } catch (error) {
      return this.unknown('unavailable', sources.length, { errorName: nameOf(error) });
    }

    if (draft.answer === null) return this.unknown('not_in_sources', sources.length);

    const checked = checkAnswer(
      { answer: draft.answer, sources: draft.sources },
      sources,
      MAX_LENGTH[style],
    );
    if (!checked.ok) {
      return this.unknown('rejected', sources.length, { rejection: checked.reason });
    }

    const titles = [...new Set(checked.used.map(source => source.title))];
    this.logger.info(
      {
        component: 'knowledge',
        chunks: sources.length,
        sources: titles,
        ...(style === 'broad' ? { style } : {}),
      },
      'Dúvida respondida',
    );
    return { kind: 'answered', text: checked.text, sources: titles };
  }

  private async retrieve(question: string, style: AnswerStyle): Promise<Retrieved> {
    if (style === 'focused') return this.searchSanitized(question);
    try {
      const all = await this.repository.listChunks(this.embeddings.model, FULL_BASE_CHUNKS + 1);
      if (all.length === 0) return { status: 'index_empty' };
      if (all.length <= FULL_BASE_CHUNKS) return { status: 'ok', chunks: all };
    } catch (error) {
      return { status: 'unavailable', errorName: nameOf(error) };
    }
    return this.searchSanitized(question, BROAD_TOP_K);
  }

  private async searchSanitized(question: string, topK = this.config.topK): Promise<SearchResult> {
    try {
      const [embedding] = await this.embeddings.embed([question], SEARCH_OPERATION);
      const { byVector, byText } = await this.repository.findCandidates({
        embedding,
        question,
        model: this.embeddings.model,
        limit: CANDIDATES_PER_LIST,
      });
      if (byVector.length === 0) return { status: 'index_empty' };
      return { status: 'ok', chunks: fuseCandidates(byVector, byText, { ...this.config, topK }) };
    } catch (error) {
      return { status: 'unavailable', errorName: nameOf(error) };
    }
  }

  private unknown(
    reason: UnknownReason,
    chunks: number,
    details: UnknownDetails = {},
    logged: LoggedReason = reason,
  ): KnowledgeAnswer {
    this.logger.warn(
      { component: 'knowledge', reason: logged, ...details, chunks },
      'Dúvida sem resposta',
    );
    return { kind: 'unknown', reason };
  }
}
