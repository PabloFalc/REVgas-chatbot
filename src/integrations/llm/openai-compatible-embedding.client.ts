import {
  type LlmError,
  LlmResponseError,
  LlmUnavailableError,
  mapLlmError,
} from '../../core/erros/llm/llm.errors';
import type { EmbeddingClient } from './embedding.client';
import {
  type EmbeddingRequest,
  type EmbeddingResult,
  embeddingResponseSchema,
} from './embedding.schemas';
import type { LlmLogger } from './llm.client';
import { postJson } from './shared/llm-http';

export type OpenAiCompatibleEmbeddingOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
  batchSize: number;
  timeoutMs: number;
  logger: LlmLogger;
  fetch?: typeof fetch;
  now?: () => number;
};

type Batch = {
  vectors: number[][];
  model: string;
  inputTokens?: number;
  status: number;
};

export class OpenAiCompatibleEmbeddingClient implements EmbeddingClient {
  readonly model: string;
  readonly dimensions: number;
  private readonly url: string;
  private readonly apiKey: string;
  private readonly batchSize: number;
  private readonly timeoutMs: number;
  private readonly logger: LlmLogger;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(options: OpenAiCompatibleEmbeddingOptions) {
    this.url = `${options.baseUrl.replace(/\/+$/, '')}/embeddings`;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.batchSize = options.batchSize;
    this.timeoutMs = options.timeoutMs;
    this.logger = options.logger;
    this.fetchFn = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    if (request.input.length === 0) {
      return { vectors: [], model: this.model, usage: {}, durationMs: 0 };
    }

    const startedAt = this.now();
    const vectors: number[][] = [];
    let model = this.model;
    let inputTokens: number | undefined;
    let status = 200;

    for (let from = 0; from < request.input.length; from += this.batchSize) {
      const chunk = request.input.slice(from, from + this.batchSize);
      const batch = await this.embedBatch(request, chunk, startedAt);
      vectors.push(...batch.vectors);
      model = batch.model;
      status = batch.status;
      if (batch.inputTokens !== undefined) {
        inputTokens = (inputTokens ?? 0) + batch.inputTokens;
      }
    }

    const durationMs = this.now() - startedAt;
    this.logger.info(
      {
        component: 'llm',
        operation: request.operation,
        model,
        status,
        durationMs,
        inputTokens,
        inputs: request.input.length,
      },
      'llm request',
    );
    return { vectors, model, usage: { inputTokens }, durationMs };
  }

  private async embedBatch(
    request: EmbeddingRequest,
    input: string[],
    startedAt: number,
  ): Promise<Batch> {
    const outcome = await postJson({
      url: this.url,
      apiKey: this.apiKey,
      body: { model: this.model, input, dimensions: this.dimensions },
      timeoutMs: request.timeoutMs ?? this.timeoutMs,
      fetch: this.fetchFn,
    });
    const durationMs = this.now() - startedAt;
    const context = { component: 'llm', operation: request.operation, model: this.model };

    if (outcome.kind === 'failure') {
      const error = outcome.timedOut ? 'timeout' : 'network';
      this.logger.warn({ ...context, durationMs, error }, 'llm request failed');
      throw new LlmUnavailableError(
        outcome.timedOut ? 'Chamada de embedding expirou' : 'Falha de rede na chamada de embedding',
      );
    }

    if (!outcome.ok) {
      const error = mapLlmError(outcome.status, outcome.body);
      this.logger.warn(
        { ...context, status: outcome.status, durationMs, error: error.kind },
        'llm request failed',
      );
      throw error;
    }

    const envelope = embeddingResponseSchema.safeParse(outcome.body);
    if (!envelope.success) {
      throw this.responseFailure(
        context,
        outcome.status,
        durationMs,
        'Resposta de embedding fora do formato esperado',
      );
    }

    const data = envelope.data;
    if (data.data.length !== input.length) {
      throw this.responseFailure(
        context,
        outcome.status,
        durationMs,
        'Quantidade de vetores diferente da de textos enviados',
      );
    }

    const ordered = data.data
      .map((item, position) => ({ index: item.index ?? position, embedding: item.embedding }))
      .sort((a, b) => a.index - b.index);

    const vectors: number[][] = [];
    for (const { embedding } of ordered) {
      const vector = this.normalize(embedding);
      if (!vector) {
        throw this.responseFailure(
          context,
          outcome.status,
          durationMs,
          'Vetor de embedding inválido (dimensão menor que a esperada ou vetor nulo)',
        );
      }
      vectors.push(vector);
    }

    return {
      vectors,
      model: data.model ?? this.model,
      inputTokens: data.usage?.prompt_tokens,
      status: outcome.status,
    };
  }

  private normalize(embedding: number[]): number[] | undefined {
    if (embedding.length < this.dimensions) {
      return undefined;
    }
    const cut =
      embedding.length > this.dimensions ? embedding.slice(0, this.dimensions) : embedding;
    const norm = Math.sqrt(cut.reduce((sum, x) => sum + x * x, 0));
    if (!Number.isFinite(norm) || norm === 0) {
      return undefined;
    }
    return cut.map(x => x / norm);
  }

  private responseFailure(
    context: { component: string; operation: string; model: string },
    status: number,
    durationMs: number,
    message: string,
  ): LlmError {
    const error = new LlmResponseError(message, status);
    this.logger.warn({ ...context, status, durationMs, error: error.kind }, 'llm request failed');
    return error;
  }
}
