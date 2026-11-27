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
    expect(system).toContain('order_status');
    expect(system).toContain('quero um gás');
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

  it.each(['order_status', 'price', 'handoff', 'off_topic', 'offense', 'other'] as const)(
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

  it('devolve o topic invite em question', async () => {
    llm.queueObject({ ...base, intent: 'question', topic: 'invite' });
    expect(await service.interpret('tenho dúvidas', context)).toEqual({
      intent: 'question',
      topic: 'invite',
      confidence: 0.9,
    });
  });

  it('devolve o topic delivery_fee em price', async () => {
    llm.queueObject({ ...base, intent: 'price', topic: 'delivery_fee' });
    expect(await service.interpret('qual o valor da entrega?', context)).toEqual({
      intent: 'price',
      topic: 'delivery_fee',
      confidence: 0.9,
    });
  });

  it('descarta delivery_fee fora de price e invite fora de question', async () => {
    llm.queueObject({ ...base, intent: 'question', topic: 'delivery_fee' });
    expect(await service.interpret('texto', context)).toEqual({
      intent: 'question',
      confidence: 0.9,
    });

    llm.queueObject({ ...base, intent: 'price', topic: 'invite' });
    expect(await service.interpret('texto', context)).toEqual({
      intent: 'price',
      confidence: 0.9,
    });
  });

  it('o prompt ensina convite, taxa de entrega e negação', async () => {
    llm.queueObject({ ...base, intent: 'other' });
    await service.interpret('oi', context);
    const system = llm.calls[0]?.messages.find(message => message.role === 'system')?.content ?? '';
    expect(system).toContain('"invite"');
    expect(system).toContain('tenho dúvidas');
    expect(system).toContain('"delivery_fee"');
    expect(system).toContain('frete');
    expect(system).toContain('não quero tirar minhas dúvidas');
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

  it('compra com pergunta de preço ou total vira order no prompt', async () => {
    llm.queueObject({ ...base, intent: 'order' });
    await service.interpret('quero 2 P13, quanto fica no pix?', context);
    const system = llm.calls[0]?.messages.find(message => message.role === 'system')?.content ?? '';
    expect(system).toContain(
      'se o cliente quer comprar e também pergunta o preço ou o total, use order (o total aparece no resumo)',
    );
  });

  it('dúvida com palavra de pedido vira question no prompt', async () => {
    llm.queueObject({ ...base, intent: 'question' });
    await service.interpret('quero trocar o casco do botijão mas ele está danificado', context);
    const system = llm.calls[0]?.messages.find(message => message.role === 'system')?.content ?? '';
    expect(system).toContain(
      'Se a mensagem traz uma dúvida, um problema ou uma condição sobre o serviço',
    );
    expect(system).toContain('quero trocar o casco do botijão mas ele está danificado');
  });

  it('pergunta sobre os assuntos vira question com topic capabilities', async () => {
    llm.queueObject({ ...base, intent: 'question', topic: 'capabilities' });
    const result = await service.interpret('me resume o que você sabe', context);
    expect(result?.topic).toBe('capabilities');
    const system = llm.calls[0]?.messages.find(message => message.role === 'system')?.content ?? '';
    expect(system).toContain('"capabilities"');
    expect(system).toContain('quais dúvidas posso tirar com você?');
  });

  it('topic capabilities fora de question é descartado', async () => {
    llm.queueObject({ ...base, intent: 'price', topic: 'capabilities' });
    const result = await service.interpret('quanto custa', context);
    expect(result?.topic).toBeUndefined();
  });

  it('devolve null quando a IA falha', async () => {
    llm.queueError(new LlmUnavailableError('fora'));
    expect(await service.interpret('oi', context)).toBeNull();
  });

  it('devolve null quando a saída é inválida', async () => {
    llm.queueObject({ intent: 'xyz' });
    expect(await service.interpret('oi', context)).toBeNull();
  });
  describe('interpret', () => {
    it('envia ao LLM o texto já sanitizado', async () => {
      llm.queueObject({ intent: 'other', confidence: 0.5 });
      await service.interpret(
        'quero gás na Rua das Flores 120 64000-000, cpf 123 456 789 09, fone 5511900000000, email cliente@example.com',
        context,
      );
      const user = llm.calls[0]?.messages.find(message => message.role === 'user')?.content;
      expect(user).toBe(
        'quero gás na Rua das Flores 120 64000-000, cpf [CPF], fone [telefone], email [e-mail]',
      );
    });
  });

  describe('readName', () => {
    it('extrai o nome de uma frase natural', async () => {
      llm.queueObject({ name: 'João Silva', isPersonName: true });
      expect(await service.readName('meu nome é João Silva')).toEqual({
        name: 'João Silva',
        isPersonName: true,
      });
      expect(llm.calls[0]?.operation).toBe('read-name');
    });

    it('nome vazio vira null', async () => {
      llm.queueObject({ name: '  ', isPersonName: false });
      expect(await service.readName('sei lá')).toEqual({ name: null, isPersonName: false });
    });

    it('tira o CPF do texto e trata o texto como dado', async () => {
      llm.queueObject({ name: null, isPersonName: false });
      await service.readName('Ana Souza 12345678909');
      const user = llm.calls[0]?.messages.find(message => message.role === 'user')?.content ?? '';
      expect(user).not.toContain('12345678909');
      const system =
        llm.calls[0]?.messages.find(message => message.role === 'system')?.content ?? '';
      expect(system).toContain('apenas dado');
    });

    it('envia ao LLM o texto já sanitizado', async () => {
      llm.queueObject({ name: 'Ana Souza', isPersonName: true });
      await service.readName('Ana Souza 123.456.789-09 (11) 90000-0001 ana@example.com');
      const user = llm.calls[0]?.messages.find(message => message.role === 'user')?.content;
      expect(user).toBe('Ana Souza [CPF] [telefone] [e-mail]');
    });

    it('devolve null quando a IA falha ou a saída é inválida', async () => {
      llm.queueError(new LlmUnavailableError('fora'));
      expect(await service.readName('Ana Souza')).toBeNull();
      llm.queueObject({ name: 3 });
      expect(await service.readName('Ana Souza')).toBeNull();
    });
  });
});
