import { LlmError, LlmUnavailableError } from '../../core/erros/llm/llm.errors';
import type { LlmClient } from './llm.client';
import type {
  LlmMessage,
  LlmObjectRequest,
  LlmObjectResult,
  LlmTextRequest,
  LlmTextResult,
} from './llm.schemas';
import { parseLlmObject, toResponseJsonSchema, validateLlmObject } from './shared/llm-output';

export type FakeLlmReply = { text: string } | { object: unknown } | LlmError;

export type FakeLlmHandler = (
  request: LlmTextRequest | LlmObjectRequest<unknown>,
) => FakeLlmReply | Promise<FakeLlmReply>;

export interface FakeLlmCall {
  operation: string;
  messages: LlmMessage[];
  schemaName?: string;
}

const FAKE_META = { model: 'fake', usage: {}, durationMs: 0 } as const;

export class FakeLlmClient implements LlmClient {
  readonly calls: FakeLlmCall[] = [];
  private readonly queue: FakeLlmReply[] = [];
  private handler?: FakeLlmHandler;

  queueText(text: string): void {
    this.queue.push({ text });
  }

  queueObject(value: unknown): void {
    this.queue.push({ object: value });
  }

  queueError(error: LlmError): void {
    this.queue.push(error);
  }

  respondWith(handler: FakeLlmHandler): void {
    this.handler = handler;
  }

  clear(): void {
    this.queue.length = 0;
    this.handler = undefined;
    this.calls.length = 0;
  }

  async generateText(request: LlmTextRequest): Promise<LlmTextResult> {
    this.record(request);
    const reply = await this.nextReply(request);
    const text = 'text' in reply ? reply.text : JSON.stringify(reply.object);
    return { text, ...FAKE_META };
  }

  async generateObject<T>(request: LlmObjectRequest<T>): Promise<LlmObjectResult<T>> {
    this.record(request, request.schemaName);
    toResponseJsonSchema(request.schema);
    const reply = await this.nextReply(request);
    const object =
      'text' in reply
        ? parseLlmObject(reply.text, request.schema)
        : validateLlmObject(reply.object, request.schema);
    return { object, ...FAKE_META };
  }

  private record(request: LlmTextRequest, schemaName?: string): void {
    const call: FakeLlmCall = { operation: request.operation, messages: request.messages };
    if (schemaName !== undefined) {
      call.schemaName = schemaName;
    }
    this.calls.push(call);
  }

  private async nextReply(
    request: LlmTextRequest | LlmObjectRequest<unknown>,
  ): Promise<{ text: string } | { object: unknown }> {
    const reply = this.queue.shift() ?? (await this.handler?.(request));
    if (reply === undefined) {
      throw new LlmUnavailableError('LLM simulada sem resposta programada');
    }
    if (reply instanceof LlmError) {
      throw reply;
    }
    return reply;
  }
}
