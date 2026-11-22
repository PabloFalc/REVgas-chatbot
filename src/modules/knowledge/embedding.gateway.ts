import { Inject, Injectable } from '@nestjs/common';
import { EMBEDDING_CLIENT, type EmbeddingClient } from '../../integrations/llm/embedding.client';

@Injectable()
export class EmbeddingGateway {
  constructor(@Inject(EMBEDDING_CLIENT) private readonly client: EmbeddingClient) {}

  get model(): string {
    return this.client.model;
  }

  get dimensions(): number {
    return this.client.dimensions;
  }

  async embed(texts: string[], operation: string, timeoutMs?: number): Promise<number[][]> {
    const result = await this.client.embed({ operation, input: texts, timeoutMs });
    return result.vectors;
  }
}
