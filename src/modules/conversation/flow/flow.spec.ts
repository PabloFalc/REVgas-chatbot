import { afterEach, describe, expect, it } from 'vitest';
import { runFlow } from './flow';
import type { FlowInput, OrderState, Step, StepResult } from './flow.types';
import { msg } from './messages';
import { text } from './replies';
import { asks, handlers } from './steps';
import { createFakeTools, FAKE_PHONE, type FakeTools } from './testing/fake-tools';

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

const ALL_STEPS: Step[] = [
  'askName',
  'askCpf',
  'askMissingCpf',
  'chooseAddress',
  'askNewAddress',
  'askAddressField',
  'confirmAddress',
  'chooseProduct',
  'searchProduct',
  'chooseQuantity',
  'askQuantity',
  'choosePayment',
  'askNeedsChange',
  'askChangeAmount',
  'summary',
  'chooseCorrection',
  'creatingSale',
  'saleFailed',
];

describe('registro de etapas', () => {
  it.each(ALL_STEPS)('%s tem handler e ask registrados', step => {
    expect(handlers[step]).toBeTypeOf('function');
    expect(asks[step]).toBeTypeOf('function');
  });
});

const say = (body: string): FlowInput => ({
  phone: FAKE_PHONE,
  content: { type: 'text', text: body },
});
const pick = (id: string): FlowInput => ({
  phone: FAKE_PHONE,
  content: { type: 'choice', id, title: id },
});

class Conversation {
  state: OrderState | null = null;
  last: StepResult = { state: null, replies: [] };

  constructor(
    readonly tools: FakeTools,
    readonly phone = FAKE_PHONE,
  ) {}

  async send(input: FlowInput): Promise<StepResult> {
    this.last = await runFlow(this.state, { ...input, phone: this.phone }, this.tools);
    this.state = this.last.state;
    return this.last;
  }

  get step(): Step | undefined {
    return this.state?.step;
  }
}

describe('conversas completas', () => {
  it('cliente novo faz o pedido com dinheiro e troco', async () => {
    const tools = createFakeTools();
    const chat = new Conversation(tools, '5586988887777');
    await chat.send(say('oi'));
    expect(chat.step).toBe('askName');
    await chat.send(say('Maria da Silva'));
    expect(chat.step).toBe('askCpf');
    await chat.send(say('123.456.789-09'));
    expect(chat.step).toBe('askNewAddress');
    await chat.send(say('64000-000'));
    expect(chat.step).toBe('askAddressField');
    await chat.send(say('120'));
    expect(chat.step).toBe('confirmAddress');
    await chat.send(pick('address:ok'));
    expect(chat.step).toBe('chooseProduct');
    await chat.send(pick('product:1'));
    expect(chat.step).toBe('chooseQuantity');
    await chat.send(pick('qty:2'));
    expect(chat.step).toBe('choosePayment');
    await chat.send(pick('pay:MONEY'));
    expect(chat.step).toBe('askNeedsChange');
    await chat.send(pick('change:yes'));
    expect(chat.step).toBe('askChangeAmount');
    await chat.send(say('250'));
    expect(chat.step).toBe('summary');
    const done = await chat.send(pick('summary:confirm'));
    expect(done).toEqual({ state: null, replies: [text(msg.saleCreated(4521))] });
    const createSale = tools.calls.find(call => call.name === 'createSale');
    expect(createSale?.args[0]).toMatchObject({
      customerId: 2,
      productId: 1,
      quantity: 2,
      paymentType: 'MONEY',
      total: 220,
      observation: 'Troco para R$ 250,00',
    });
  });

  it('cliente cadastrado faz o pedido com Pix', async () => {
    const tools = createFakeTools();
    const chat = new Conversation(tools);
    await chat.send(say('oi'));
    expect(chat.step).toBe('chooseAddress');
    await chat.send(pick('address:1'));
    expect(chat.step).toBe('chooseProduct');
    await chat.send(pick('product:2'));
    expect(chat.step).toBe('chooseQuantity');
    await chat.send(pick('qty:1'));
    expect(chat.step).toBe('choosePayment');
    await chat.send(pick('pay:PIX'));
    expect(chat.step).toBe('summary');
    const done = await chat.send(pick('summary:confirm'));
    expect(done.state).toBeNull();
    expect(done.replies).toEqual([text(msg.saleCreated(4521))]);
    const createSale = tools.calls.find(call => call.name === 'createSale');
    expect(createSale?.args[0]).toMatchObject({ productId: 2, paymentType: 'PIX', total: 110 });
    expect(createSale?.args[0]).not.toHaveProperty('observation');
  });

  it('corrigir o endereço volta ao resumo', async () => {
    const chat = new Conversation(createFakeTools());
    await chat.send(say('oi'));
    await chat.send(pick('address:0'));
    await chat.send(pick('product:1'));
    await chat.send(pick('qty:1'));
    await chat.send(pick('pay:PIX'));
    expect(chat.step).toBe('summary');
    await chat.send(pick('summary:fix'));
    expect(chat.step).toBe('chooseCorrection');
    await chat.send(pick('fix:address'));
    expect(chat.step).toBe('chooseAddress');
    await chat.send(pick('address:1'));
    expect(chat.step).toBe('summary');
    expect(chat.state?.address?.number).toBe('900');
  });

  it('falha ao criar a venda e tentar de novo encontra a venda já criada', async () => {
    const tools = createFakeTools({
      createSale: async () => {
        throw new Error('timeout');
      },
      findRecentSale: async () => 9001,
    });
    const chat = new Conversation(tools);
    await chat.send(say('oi'));
    await chat.send(pick('address:0'));
    await chat.send(pick('product:1'));
    await chat.send(pick('qty:1'));
    await chat.send(pick('pay:PIX'));
    const failed = await chat.send(pick('summary:confirm'));
    expect(chat.step).toBe('saleFailed');
    expect(failed.replies[0].type).toBe('buttons');
    const retried = await chat.send(pick('retry:sale'));
    expect(retried).toEqual({ state: null, replies: [text(msg.saleCreated(9001))] });
  });

  it('cancelar no meio encerra o pedido', async () => {
    const chat = new Conversation(createFakeTools());
    await chat.send(say('oi'));
    await chat.send(pick('address:0'));
    const cancelled = await chat.send(say('cancelar'));
    expect(cancelled).toEqual({ state: null, replies: [text(msg.cancelled)] });
  });
});
