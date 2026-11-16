import type { LlmError } from '../../core/erros/llm/llm.errors';
import { normalizeText } from '../../utils/text';
import type { EmbeddingClient } from './embedding.client';
import type { EmbeddingRequest, EmbeddingResult } from './embedding.schemas';

export interface FakeEmbeddingCall {
  operation: string;
  input: string[];
}

export interface FakeEmbeddingOptions {
  dimensions?: number;
  model?: string;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(token: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

export class FakeEmbeddingClient implements EmbeddingClient {
  readonly model: string;
  readonly dimensions: number;
  readonly calls: FakeEmbeddingCall[] = [];
  private readonly errors: LlmError[] = [];

  constructor(options: FakeEmbeddingOptions = {}) {
    this.dimensions = options.dimensions ?? 768;
    this.model = options.model ?? 'fake';
  }

  queueError(error: LlmError): void {
    this.errors.push(error);
  }

  clear(): void {
    this.errors.length = 0;
    this.calls.length = 0;
  }

  vectorFor(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = normalizeText(text)
      .split(/[^a-z0-9]+/)
      .filter(token => token.length > 0);

    if (tokens.length === 0) {
      vector[0] = 1;
      return vector;
    }

    for (const token of tokens) {
      const hash = fnv1a(token);
      vector[hash % this.dimensions] += (hash >>> 16) & 1 ? -1 : 1;
    }

    const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
    if (norm === 0) {
      vector[0] = 1;
      return vector;
    }
    return vector.map(x => x / norm);
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    this.calls.push({ operation: request.operation, input: request.input });
    const error = this.errors.shift();
    if (error) {
      throw error;
    }
    return {
      vectors: request.input.map(text => this.vectorFor(text)),
      model: this.model,
      usage: {},
      durationMs: 0,
    };
  }
}
