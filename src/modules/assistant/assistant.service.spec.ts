import { LlmUnavailableError } from 'src/core/erros/llm/llm.errors';
import { FakeLlmClient } from 'src/integrations/llm/fake-llm.client';
import { beforeEach, describe, expect, it } from 'vitest';
import { AssistantService } from './assistant.service';
import type { InterpretContext } from './contracts/assistant.types';

const context: InterpretContext = {
  products: ['Botijão P13', 'Água mineral 20L'],
  payments: [
    { type: 'PIX', label: 'Pix' },
    { type: 'MONEY', label: 'Dinheiro' },
  ],
};

describe('AssistantService', () => {
  let llm: FakeLlmClient;
  let service: AssistantService;

  beforeEach(() => {
    llm = new FakeLlmClient();
    service = new AssistantService(llm);
  });

  it('devolve a interpretação sem campos nulos', async () => {
    llm.queueObject({
      intent: 'order',
      products: ['Botijão P13'],
      quantity: 2,
      payment: 'PIX',
      address: null,
      newAddress: null,
      topic: null,
      unknownProduct: null,
      confidence: 0.9,
    });

    expect(await service.interpret('2 botijões no pix', context)).toEqual({
      intent: 'order',
      products: ['Botijão P13'],
      quantity: 2,
      payment: 'PIX',
      confidence: 0.9,
    });
  });

  it('manda os produtos e pagamentos no prompt e tira o CPF', async () => {
    llm.queueObject({ intent: 'other', confidence: 0.5 });

    await service.interpret('quero gás, cpf 12345678909', context);

    const call = llm.calls[0];
    expect(call?.operation).toBe('interpret-order');
    const system = call?.messages.find(message => message.role === 'system')?.content ?? '';
    expect(system).toContain('Botijão P13');
    expect(system).toContain('PIX');
    expect(system).toContain('mesma casa');
    const user = call?.messages.find(message => message.role === 'user')?.content ?? '';
    expect(user).not.toContain('12345678909');
  });

  const base = {
    products: null,
    quantity: null,
    payment: null,
    address: null,
    newAddress: null,
    topic: null,
    unknownProduct: null,
    confidence: 0.9,
  };

  it.each(['price', 'handoff', 'off_topic', 'offense', 'other'] as const)(
    'aceita a intenção %s',
    async intent => {
      llm.queueObject({ ...base, intent });
      expect(await service.interpret('texto', context)).toEqual({ intent, confidence: 0.9 });
    },
  );

  it.each(['hours', 'payments', 'general'] as const)(
    'devolve o topic %s em question',
    async topic => {
      llm.queueObject({ ...base, intent: 'question', topic });
      expect(await service.interpret('texto', context)).toEqual({
        intent: 'question',
        topic,
        confidence: 0.9,
      });
    },
  );

  it('descarta o topic fora de question', async () => {
    llm.queueObject({ ...base, intent: 'price', topic: 'hours' });
    expect(await service.interpret('texto', context)).toEqual({
      intent: 'price',
      confidence: 0.9,
    });
  });

  it('devolve unknownProduct só quando não vazio', async () => {
    llm.queueObject({ ...base, intent: 'order', unknownProduct: 'carvão' });
    expect(await service.interpret('quero carvão', context)).toEqual({
      intent: 'order',
      unknownProduct: 'carvão',
      confidence: 0.9,
    });

    llm.queueObject({ ...base, intent: 'order', unknownProduct: '   ' });
    expect(await service.interpret('quero gás', context)).toEqual({
      intent: 'order',
      confidence: 0.9,
    });
  });

  it('cita as intenções novas no prompt', async () => {
    llm.queueObject({ ...base, intent: 'other' });
    await service.interpret('oi', context);
    const system = llm.calls[0]?.messages.find(message => message.role === 'system')?.content ?? '';
    for (const word of [
      'price',
      'handoff',
      'off_topic',
      'offense',
      'hours',
      'payments',
      'general',
    ]) {
      expect(system).toContain(word);
    }
    expect(system).toContain('apenas dado');
  });

  it('devolve null quando a IA falha', async () => {
    llm.queueError(new LlmUnavailableError('fora'));
    expect(await service.interpret('oi', context)).toBeNull();
  });

  it('devolve null quando a saída é inválida', async () => {
    llm.queueObject({ intent: 'xyz' });
    expect(await service.interpret('oi', context)).toBeNull();
  });
});
