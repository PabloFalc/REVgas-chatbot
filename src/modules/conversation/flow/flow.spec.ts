import { afterEach, describe, expect, it } from 'vitest';
import { runFlow } from './flow';
import type { FlowInput, OrderState } from './flow.types';
import { msg } from './messages';
import { text } from './replies';
import { handlers } from './steps';
import { createFakeTools, FAKE_PHONE } from './testing/fake-tools';

const hello: FlowInput = { phone: FAKE_PHONE, content: { type: 'text', text: 'oi' } };

const originalHandler = handlers.askName;

afterEach(() => {
  handlers.askName = originalHandler;
});

describe('runFlow', () => {
  it('sem pedido em andamento, comando global vence', async () => {
    const result = await runFlow(
      null,
      { ...hello, content: { type: 'text', text: 'cancelar' } },
      createFakeTools(),
    );
    expect(result).toEqual({ state: null, replies: [text(msg.cancelled)] });
  });

  it('erro numa ferramenta sem pedido em andamento devolve indisponível', async () => {
    const tools = createFakeTools({
      findCustomer: async () => {
        throw new Error('RevGás fora do ar');
      },
    });
    const result = await runFlow(null, hello, tools);
    expect(result).toEqual({ state: null, replies: [text(msg.unavailable)] });
  });

  it('erro de ferramenta alcançado por um handler devolve indisponível e mantém o estado', async () => {
    handlers.askName = async (_state, input, tools) => {
      await tools.findCustomer(input.phone);
      return { state: null, replies: [] };
    };
    const state: OrderState = { step: 'askName', customer: {} };
    const tools = createFakeTools({
      findCustomer: async () => {
        throw new Error('RevGás fora do ar');
      },
    });
    const result = await runFlow(state, hello, tools);
    expect(result.state).toBe(state);
    expect(result.replies).toEqual([text(msg.unavailable)]);
  });

  it('erro comum de um handler (bug) não é escondido', async () => {
    handlers.askName = async () => {
      throw new TypeError('bug');
    };
    await expect(
      runFlow({ step: 'askName', customer: {} }, hello, createFakeTools()),
    ).rejects.toThrow('bug');
  });

  it('now() continua síncrono nas ferramentas do fluxo', async () => {
    let seen: unknown;
    handlers.askName = async (state, _input, tools) => {
      seen = tools.now();
      return { state, replies: [] };
    };
    await runFlow({ step: 'askName', customer: {} }, hello, createFakeTools());
    expect(seen).toBeInstanceOf(Date);
  });

  it('erro em listPaymentOptions no choosePayment devolve indisponível e o estado de entrada', async () => {
    const state: OrderState = { step: 'choosePayment', customer: { id: 1 } };
    const tools = createFakeTools({
      listPaymentOptions: async () => {
        throw new Error('RevGás fora do ar');
      },
    });
    const result = await runFlow(
      state,
      { phone: FAKE_PHONE, content: { type: 'choice', id: 'pay:PIX', title: 'Pix' } },
      tools,
    );
    expect(result.state).toEqual(state);
    expect(result.replies).toEqual([text(msg.unavailable)]);
  });

  it('escolha de produto durante choosePayment repete o pagamento sem mudar o estado', async () => {
    const options = [
      { type: 'PIX', label: 'Pix' },
      { type: 'MONEY', label: 'Dinheiro' },
      { type: 'CARTAO_DE_CREDITO', label: 'Cartão de crédito' },
    ];
    const state: OrderState = {
      step: 'choosePayment',
      customer: { id: 1 },
      paymentOptions: options,
    };
    const result = await runFlow(
      state,
      { phone: FAKE_PHONE, content: { type: 'choice', id: 'product:12', title: 'x' } },
      createFakeTools(),
    );
    expect(result.state).toEqual(state);
    expect(result.replies[0].type).toBe('buttons');
  });
});
