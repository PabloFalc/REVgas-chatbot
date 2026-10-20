import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { LLM_CLIENT, type LlmClient } from './llm.client';
import { LlmModule } from './llm.module';

describe('LlmModule', () => {
  it('resolve LLM_CLIENT', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [LlmModule] }).compile();
    const client = moduleRef.get<LlmClient>(LLM_CLIENT);
    expect(typeof client.generateText).toBe('function');
    expect(typeof client.generateObject).toBe('function');
  });
});
