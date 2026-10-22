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
    const user = call?.messages.find(message => message.role === 'user')?.content ?? '';
    expect(user).not.toContain('12345678909');
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
