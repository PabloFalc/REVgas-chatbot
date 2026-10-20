import { z } from 'zod';
import {
  LlmError,
  LlmRejectedError,
  LlmResponseError,
  LlmUnavailableError,
  mapLlmError,
} from '../../core/erros/llm/llm.errors';
import { isTimeoutError } from '../../utils/guards';
import { parseJsonOrText } from '../../utils/parse-json';
import type { LlmClient, LlmLogger } from './llm.client';
import {
  type ChatCompletion,
  chatCompletionSchema,
  type LlmObjectRequest,
  type LlmObjectResult,
  type LlmTextRequest,
  type LlmTextResult,
  type LlmUsage,
} from './llm.schemas';
import { parseLlmObject } from './shared/llm-output';

export type OpenAiCompatibleOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  logger: LlmLogger;
  fetch?: typeof fetch;
  now?: () => number;
};

type Outcome =
  | { kind: 'response'; ok: boolean; status: number; body: unknown }
  | { kind: 'failure'; timedOut: boolean };

type Completed = {
  content: string;
  model: string;
  usage: LlmUsage;
  status: number;
  durationMs: number;
};

export class OpenAiCompatibleLlmClient implements LlmClient {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly logger: LlmLogger;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(options: OpenAiCompatibleOptions) {
    this.url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.logger = options.logger;
    this.fetchFn = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async generateText(request: LlmTextRequest): Promise<LlmTextResult> {
    const done = await this.complete(request, this.baseBody(request));
    this.logSuccess(request.operation, done);
    return {
      text: done.content,
      model: done.model,
      usage: done.usage,
      durationMs: done.durationMs,
    };
  }

  async generateObject<T>(request: LlmObjectRequest<T>): Promise<LlmObjectResult<T>> {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(request.schema) as Record<
      string,
      unknown
    >;
    const body = {
      ...this.baseBody(request),
      response_format: {
        type: 'json_schema',
        json_schema: { name: request.schemaName, schema, strict: true },
      },
    };
    const done = await this.complete(request, body);

    let object: T;
    try {
      object = parseLlmObject(done.content, request.schema);
    } catch (error) {
      if (error instanceof LlmError) {
        this.postFailure(request.operation, done, error);
      }
      throw error;
    }

    this.logSuccess(request.operation, done);
    return { object, model: done.model, usage: done.usage, durationMs: done.durationMs };
  }

  private baseBody(request: LlmTextRequest): Record<string, unknown> {
    return {
      model: this.model,
      messages: request.messages,
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.maxOutputTokens !== undefined && { max_tokens: request.maxOutputTokens }),
    };
  }

  private async complete(
    request: LlmTextRequest,
    body: Record<string, unknown>,
  ): Promise<Completed> {
    const startedAt = this.now();
    const outcome = await this.post(body, request.timeoutMs ?? this.timeoutMs);
    const durationMs = this.now() - startedAt;
    const { operation } = request;

    if (outcome.kind === 'failure') {
      const error = outcome.timedOut ? 'timeout' : 'network';
      this.logger.warn(
        { component: 'llm', operation, model: this.model, durationMs, error },
        'llm request failed',
      );
      throw new LlmUnavailableError(
        outcome.timedOut ? 'Chamada à LLM expirou' : 'Falha de rede na chamada à LLM',
      );
    }

    if (!outcome.ok) {
      const error = mapLlmError(outcome.status, outcome.body);
      this.logger.warn(
        {
          component: 'llm',
          operation,
          model: this.model,
          status: outcome.status,
          durationMs,
          error: error.kind,
        },
        'llm request failed',
      );
      throw error;
    }

    const envelope = chatCompletionSchema.safeParse(outcome.body);
    const partial = { status: outcome.status, durationMs };
    if (!envelope.success) {
      throw this.postFailure(
        operation,
        { ...partial, model: this.model },
        new LlmResponseError('Resposta da LLM fora do formato esperado', outcome.status),
      );
    }

    return this.interpret(operation, envelope.data, partial);
  }

  private interpret(
    operation: string,
    data: ChatCompletion,
    partial: { status: number; durationMs: number },
  ): Completed {
    const model = data.model ?? this.model;
    const usage: LlmUsage = {
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
    };
    const [choice] = data.choices;
    const content = choice.message.content;
    const context = { ...partial, model, usage };

    if (choice.finish_reason === 'length') {
      throw this.postFailure(
        operation,
        context,
        new LlmResponseError('Resposta da LLM cortada por limite de tokens', partial.status),
      );
    }
    if (choice.finish_reason === 'content_filter') {
      throw this.postFailure(
        operation,
        context,
        new LlmRejectedError('Resposta da LLM bloqueada pelo filtro de conteúdo', partial.status),
      );
    }
    if (!content?.trim()) {
      throw this.postFailure(
        operation,
        context,
        new LlmResponseError('Resposta da LLM sem conteúdo', partial.status),
      );
    }
    return { content, model, usage, ...partial };
  }

  private postFailure(
    operation: string,
    context: { status: number; durationMs: number; model: string; usage?: LlmUsage },
    error: LlmError,
  ): LlmError {
    this.logger.warn(
      {
        component: 'llm',
        operation,
        model: context.model,
        status: context.status,
        durationMs: context.durationMs,
        error: error.kind,
      },
      'llm request failed',
    );
    return error;
  }

  private logSuccess(operation: string, done: Completed) {
    this.logger.info(
      {
        component: 'llm',
        operation,
        model: done.model,
        status: done.status,
        durationMs: done.durationMs,
        inputTokens: done.usage.inputTokens,
        outputTokens: done.usage.outputTokens,
      },
      'llm request',
    );
  }

  private async post(body: Record<string, unknown>, timeoutMs: number): Promise<Outcome> {
    try {
      const response = await this.fetchFn(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const parsed = parseJsonOrText(await response.text());
      return { kind: 'response', ok: response.ok, status: response.status, body: parsed };
    } catch (error) {
      return { kind: 'failure', timedOut: isTimeoutError(error) };
    }
  }
}
