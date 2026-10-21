import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { env } from '../src/config/env';
import { LlmUnauthorizedError } from '../src/core/erros/llm/llm.errors';
import type { LlmClient } from '../src/integrations/llm/llm.client';
import { createLlmClient } from '../src/integrations/llm/llm.factory';
import { type LlmConfig, resolveLlmConfig } from '../src/integrations/llm/shared/llm.config';

describe.skipIf(!env.LLM_API_KEY)('LLM API real (Gemini)', () => {
  let config: LlmConfig;
  let llm: LlmClient;

  beforeAll(() => {
    config = resolveLlmConfig({ ...env, LLM_MODE: 'live' });
    llm = createLlmClient(config);
  });

  it('generateText responde texto não vazio', async () => {
    const { text } = await llm.generateText({
      operation: 'check',
      messages: [{ role: 'user', content: 'Responda apenas: ok' }],
    });
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('generateObject segue um schema parecido com interpretar()', async () => {
    const schema = z.object({
      intencao: z.enum(['pedido', 'duvida', 'atendente', 'outro']),
      quantidade: z.number().int().positive().optional(),
      pagamento: z.enum(['pix', 'dinheiro', 'cartao']).optional(),
      endereco: z.object({ logradouro: z.string(), numero: z.string().optional() }).optional(),
      confianca: z.number().min(0).max(1),
    });
    const { object } = await llm.generateObject({
      operation: 'check',
      schemaName: 'interpretacao',
      schema,
      messages: [
        { role: 'system', content: 'Extraia o pedido de gás.' },
        { role: 'user', content: 'manda 2 botijão no pix' },
      ],
    });
    expect(object.intencao).toBe('pedido');
    expect(object.quantidade).toBe(2);
  });

  it('chave inválida → LlmUnauthorizedError', async () => {
    const invalid = createLlmClient({ ...config, apiKey: 'chave-invalida' });
    await expect(
      invalid.generateText({
        operation: 'check',
        messages: [{ role: 'user', content: 'oi' }],
      }),
    ).rejects.toBeInstanceOf(LlmUnauthorizedError);
  });
});
