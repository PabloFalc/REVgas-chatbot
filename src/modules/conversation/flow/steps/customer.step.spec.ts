import {
  CpfTakenError,
  CustomerRejectedError,
} from 'src/modules/customer/contracts/customer.types';
import { describe, expect, it, vi } from 'vitest';
import { type FlowInput, ToolError } from '../flow.types';
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

  it('cliente sem CPF é recebido e o CPF é pedido', async () => {
    const tools = createFakeTools({
      findCustomer: async () => ({ id: 7, name: 'Joana Lima', cpf: null, tagId: 3 }),
    });
    const result = await start(say('oi'), tools);
    expect(result.state).toEqual({
      step: 'askMissingCpf',
      customer: { id: 7, name: 'Joana Lima', tagId: 3 },
    });
    expect(result.replies).toEqual([text(msg.welcomeBack('Joana Lima')), text(msg.askMissingCpf)]);
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
    expect(tools.calls.map(call => call.name)).toEqual(['findCustomer', 'customerHistory']);
  });
});

describe('askName', () => {
  const state = { step: 'askName' as const, customer: {} };

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

describe('askMissingCpf', () => {
  const state = {
    step: 'askMissingCpf' as const,
    customer: { id: 7, name: 'Joana Lima', tagId: 3 },
  };

  it('pergunta o CPF', async () => {
    const result = await asks.askMissingCpf?.(state, createFakeTools());
    expect(result?.replies).toEqual([text(msg.askMissingCpf)]);
  });

  it('CPF válido é salvo, histórico carregado e o fluxo segue', async () => {
    const tools = createFakeTools();
    const result = await handlers.askMissingCpf?.(state, say(VALID_CPF), tools);
    expect(tools.calls).toContainEqual({ name: 'saveCpf', args: [7, '12345678909'] });
    expect(tools.calls.map(call => call.name)).toEqual(['saveCpf', 'customerHistory']);
    expect(result?.state?.customer.cpf).toBe('12345678909');
    expect(result?.state?.addresses).toHaveLength(2);
    expect(result?.state?.boughtProductIds).toEqual([2]);
    expect(result?.state?.step).toBe('chooseAddress');
  });

  it('CPF já cadastrado em outro cliente encerra com a mensagem de CPF já cadastrado', async () => {
    const tools = createFakeTools({
      saveCpf: async () => {
        throw new ToolError(new CpfTakenError());
      },
    });
    const result = await handlers.askMissingCpf?.(state, say(VALID_CPF), tools);
    expect(result).toEqual({ state: null, replies: [text(msg.cpfTaken(tools.storePhone))] });
  });

  it('CPF rejeitado pelo RevGás pede o CPF de novo', async () => {
    const tools = createFakeTools({
      saveCpf: async () => {
        throw new ToolError(new CustomerRejectedError());
      },
    });
    const result = await handlers.askMissingCpf?.(state, say(VALID_CPF), tools);
    expect(result).toEqual({ state, replies: [text(msg.invalidCpf)] });
  });

  it('outro erro ao salvar o CPF é repassado', async () => {
    const boom = new ToolError(new Error('fora do ar'));
    const tools = createFakeTools({
      saveCpf: async () => {
        throw boom;
      },
    });
    await expect(handlers.askMissingCpf?.(state, say(VALID_CPF), tools)).rejects.toBe(boom);
  });

  it('CPF inválido não salva nada', async () => {
    const tools = createFakeTools();
    const result = await handlers.askMissingCpf?.(state, say('123'), tools);
    expect(tools.calls).toEqual([]);
    expect(result?.state).toBe(state);
    expect(result?.replies).toEqual([text(msg.invalidCpf)]);
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

  it('askMissingCpf concluído reconfere o produto com o cliente identificado', async () => {
    const tools = createFakeTools({ listProducts: async () => [p45] });
    const spy = vi.spyOn(tools, 'listProducts');
    const state = {
      step: 'askMissingCpf' as const,
      customer: { id: 7, name: 'Joana Lima', tagId: 3 },
      product: p13,
      quantity: 2,
    };
    const result = await handlers.askMissingCpf?.(state, say(VALID_CPF), tools);
    expect(spy).toHaveBeenCalledWith({ id: 7, tagId: 3 });
    expect(result?.state?.product).toBeUndefined();
  });
});
