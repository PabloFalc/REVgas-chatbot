import { describe, expect, it, vi } from 'vitest';
import type { FlowInput } from '../flow.types';
import { msg } from '../messages';
import { text } from '../replies';
import { createFakeTools, FAKE_PHONE } from '../testing/fake-tools';
import { asks, handlers, start } from './customer.step';
import './index';

const say = (body: string): FlowInput => ({
  phone: FAKE_PHONE,
  content: { type: 'text', text: body },
});

const VALID_CPF = '123.456.789-09';

describe('start', () => {
  it('cliente desconhecido recebe boas-vindas e vai pedir o nome', async () => {
    const result = await start({ ...say('oi'), phone: '5500000000000' }, createFakeTools());
    expect(result).toEqual({
      state: { step: 'askName', customer: {} },
      replies: [text(msg.welcomeNew)],
    });
  });

  it('cliente sem CPF recebe o contato da revenda', async () => {
    const tools = createFakeTools({
      findCustomer: async () => ({ id: 7, name: 'Joana Lima', cpf: null, tagId: 3 }),
    });
    const result = await start(say('oi'), tools);
    expect(result).toEqual({
      state: null,
      replies: [text(msg.identityContactStore('86999990000'))],
    });
    expect(JSON.stringify(result.replies)).not.toContain('Joana');
  });

  it('telefone bloqueado recebe o contato da revenda', async () => {
    const tools = createFakeTools({ isBlocked: async () => true });
    const result = await start(say('oi'), tools);
    expect(result).toEqual({
      state: null,
      replies: [text(msg.identityContactStore('86999990000'))],
    });
    expect(JSON.stringify(result.replies)).not.toContain('Maria');
    expect(tools.calls.map(call => call.name)).not.toContain('customerHistory');
  });

  it('não verificado pede os 3 dígitos sem mostrar o nome', async () => {
    const tools = createFakeTools({ isVerified: async () => false });
    const spy = vi.spyOn(tools, 'isVerified');
    const result = await start(say('oi'), tools);
    expect(result.state).toEqual({
      step: 'askCpfPrefix',
      customer: { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: null },
    });
    expect(result.replies).toEqual([text(msg.askCpfPrefix)]);
    expect(JSON.stringify(result.replies)).not.toContain('Maria');
    expect(tools.calls.map(call => call.name)).not.toContain('customerHistory');
    expect(spy).toHaveBeenCalledWith(FAKE_PHONE, 1);
  });

  it('cliente com CPF carrega histórico e segue para o fluxo', async () => {
    const tools = createFakeTools();
    const result = await start(say('oi'), tools);
    expect(result.replies[0]).toEqual(text(msg.welcomeBack('Maria da Silva')));
    expect(result.state?.customer).toEqual({
      id: 1,
      name: 'Maria da Silva',
      cpf: '12345678909',
      tagId: null,
    });
    expect(result.state?.addresses).toHaveLength(2);
    expect(result.state?.boughtProductIds).toEqual([2]);
    expect(result.state?.step).toBe('chooseAddress');
    expect(tools.calls.map(call => call.name)).toEqual([
      'findCustomer',
      'isBlocked',
      'isVerified',
      'customerHistory',
    ]);
  });
});

describe('askName', () => {
  const state = { step: 'askName' as const, customer: {} };

  it('texto com palavra de pedido que a IA diz não ser pedido vira o nome', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'other', confidence: 0.9 }),
    });
    const result = await handlers.askName?.(state, say('Maria da Rua Silva'), tools);
    expect(result?.state).toMatchObject({
      step: 'askCpf',
      customer: { name: 'Maria da Rua Silva' },
    });
    expect(result?.replies).toEqual([text(msg.askCpf)]);
  });

  it('sem resposta da IA o texto de pedido não vira o nome', async () => {
    const tools = createFakeTools({ interpret: async () => null });
    const result = await handlers.askName?.(state, say('quero gás no pix'), tools);
    expect(result?.state).toMatchObject({ step: 'askName' });
    expect(result?.state?.customer.name).toBeUndefined();
    expect(result?.replies).toEqual([text(msg.notUnderstood), text(msg.askName)]);
  });

  it('IA com pouca confiança não vira o nome', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'other', confidence: 0.3 }),
    });
    const result = await handlers.askName?.(state, say('quero gás no pix'), tools);
    expect(result?.state?.customer.name).toBeUndefined();
  });

  it('pergunta no nome responde fora do escopo e não vira o nome', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'question', confidence: 0.9 }),
    });
    const result = await handlers.askName?.(state, say('quero saber se entregam hoje'), tools);
    expect(result?.state?.customer.name).toBeUndefined();
    expect(result?.replies).toEqual([text(msg.offTopic(tools.storePhone)), text(msg.askName)]);
  });

  it('pergunta o nome', async () => {
    const result = await asks.askName?.(state, createFakeTools());
    expect(result?.replies).toEqual([text(msg.askName)]);
  });

  it('guarda o nome e pede o CPF', async () => {
    const result = await handlers.askName?.(state, say('  Maria   da Silva '), createFakeTools());
    expect(result?.state).toEqual({ step: 'askCpf', customer: { name: 'Maria da Silva' } });
    expect(result?.replies).toEqual([text(msg.askCpf)]);
  });

  it.each(['Maria', '   ', `Ana ${'b'.repeat(100)}`])('recusa o nome %j', async raw => {
    const result = await handlers.askName?.(state, say(raw), createFakeTools());
    expect(result?.state).toBe(state);
    expect(result?.replies).toEqual([text(msg.invalidName)]);
  });

  it('nome com dígito vai para a IA e, sem resposta, repete a pergunta', async () => {
    const result = await handlers.askName?.(state, say('123 456'), createFakeTools());
    expect(result?.state).toMatchObject({ step: 'askName' });
    expect(result?.replies).toEqual([text(msg.notUnderstood), text(msg.askName)]);
  });

  it('recusa entrada que não é texto', async () => {
    const input: FlowInput = {
      phone: FAKE_PHONE,
      content: { type: 'choice', id: 'x', title: 'x' },
    };
    const result = await handlers.askName?.(state, input, createFakeTools());
    expect(result?.replies).toEqual([text(msg.invalidName)]);
  });
});

describe('askCpf', () => {
  const state = { step: 'askCpf' as const, customer: { name: 'Maria da Silva' } };

  it('guarda só os dígitos e segue para o endereço novo', async () => {
    const result = await handlers.askCpf?.(state, say(VALID_CPF), createFakeTools());
    expect(result?.state?.customer).toEqual({ name: 'Maria da Silva', cpf: '12345678909' });
    expect(result?.state?.step).toBe('askNewAddress');
  });

  it('CPF inválido não repete o número digitado', async () => {
    const result = await handlers.askCpf?.(state, say('111.222.333-44'), createFakeTools());
    expect(result?.state).toBe(state);
    expect(result?.replies).toEqual([text(msg.invalidCpf)]);
    const body = JSON.stringify(result?.replies);
    expect(body).not.toContain('111');
    expect(body).not.toContain('44');
  });
});

describe('askCpfPrefix', () => {
  const state = {
    step: 'askCpfPrefix' as const,
    customer: { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: null },
  };

  it('acerto marca verificado, dá as boas-vindas e segue o fluxo', async () => {
    const tools = createFakeTools({ isVerified: async () => false });
    const spy = vi.spyOn(tools, 'markVerified');
    const result = await handlers.askCpfPrefix?.(state, say('123'), tools);
    expect(spy).toHaveBeenCalledWith(FAKE_PHONE, 1);
    expect(result?.replies[0]).toEqual(text(msg.welcomeBack('Maria da Silva')));
    expect(result?.state?.step).toBe('chooseAddress');
    expect(result?.state?.addresses).toHaveLength(2);
  });

  it('aceita "123." com pontuação', async () => {
    const tools = createFakeTools();
    const result = await handlers.askCpfPrefix?.(state, say('123.'), tools);
    expect(tools.calls.map(call => call.name)).toContain('markVerified');
    expect(result?.state?.step).toBe('chooseAddress');
  });

  it.each([1, 2])('erro %i repete a pergunta mantendo o estado', async count => {
    const tools = createFakeTools({ registerCpfMismatch: async () => count });
    const spy = vi.spyOn(tools, 'registerCpfMismatch');
    const result = await handlers.askCpfPrefix?.(state, say('999'), tools);
    expect(spy).toHaveBeenCalledWith(FAKE_PHONE);
    expect(result).toEqual({ state, replies: [text(msg.cpfPrefixMismatch)] });
    expect(tools.calls.map(call => call.name)).not.toContain('markVerified');
  });

  it('terceiro erro encerra com o contato da revenda', async () => {
    const tools = createFakeTools({ registerCpfMismatch: async () => 3 });
    const result = await handlers.askCpfPrefix?.(state, say('999'), tools);
    expect(result).toEqual({
      state: null,
      replies: [text(msg.identityContactStore('86999990000'))],
    });
  });

  it('CPF inteiro não conta tentativa', async () => {
    const tools = createFakeTools();
    const result = await handlers.askCpfPrefix?.(state, say('12345678909'), tools);
    expect(tools.calls.map(call => call.name)).not.toContain('registerCpfMismatch');
    expect(result).toEqual({ state, replies: [text(msg.cpfPrefixFormat)] });
  });

  it('respostas nunca repetem os dígitos digitados', async () => {
    const tools = createFakeTools();
    const result = await handlers.askCpfPrefix?.(state, say('987'), tools);
    expect(JSON.stringify(result?.replies)).not.toContain('987');
  });

  it('texto de pedido anota e repete a pergunta', async () => {
    const tools = createFakeTools({
      interpret: async () => ({
        intent: 'order',
        products: ['Botijão P13'],
        confidence: 0.9,
      }),
    });
    const result = await handlers.askCpfPrefix?.(state, say('quero um botijão P13'), tools);
    expect(result?.replies).toEqual([text(msg.noted(['Botijão P13'])), text(msg.askCpfPrefix)]);
    expect(result?.state?.product).toEqual({ id: 1, name: 'Botijão P13' });
    expect(result?.state?.step).toBe('askCpfPrefix');
    expect(tools.calls.map(call => call.name)).not.toContain('registerCpfMismatch');
  });
});

describe('produto oferecido na primeira mensagem', () => {
  const p13 = { id: 1, name: 'Botijão P13' };
  const p45 = { id: 2, name: 'Botijão P45' };

  it('start de cliente cadastrado reconfere o produto com o cliente identificado', async () => {
    const tools = createFakeTools({ listProducts: async () => [p45] });
    const spy = vi.spyOn(tools, 'listProducts');
    const result = await start(say('oi'), tools, { product: p13, quantity: 2 });
    expect(spy).toHaveBeenCalledWith({ id: 1, tagId: null });
    expect(result.state?.product).toBeUndefined();
    expect(result.state?.quantity).toBeUndefined();
  });

  it('askCpfPrefix concluído reconfere o produto com o cliente identificado', async () => {
    const tools = createFakeTools({ listProducts: async () => [p45] });
    const spy = vi.spyOn(tools, 'listProducts');
    const state = {
      step: 'askCpfPrefix' as const,
      customer: { id: 7, name: 'Joana Lima', cpf: '12345678909', tagId: 3 },
      product: p13,
      quantity: 2,
    };
    const result = await handlers.askCpfPrefix?.(state, say('123'), tools);
    expect(spy).toHaveBeenCalledWith({ id: 7, tagId: 3 });
    expect(result?.state?.product).toBeUndefined();
  });
});
