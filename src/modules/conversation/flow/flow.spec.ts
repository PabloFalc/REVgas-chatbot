import {
  CpfTakenError,
  CustomerRejectedError,
} from 'src/modules/customer/contracts/customer.types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runFlow } from './flow';
import {
  type FlowInput,
  type OrderState,
  type Step,
  type StepResult,
  ToolError,
} from './flow.types';
import { HANDOFF_CHOICE, ORDER_START_CHOICE, offer } from './handoff';
import { msg } from './messages';
import { buttons, text } from './replies';
import { asks, handlers } from './steps';
import { createFakeTools, FAKE_NOW, FAKE_PHONE, type FakeTools } from './testing/fake-tools';

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

  it('etapa desconhecida no estado salvo começa um pedido novo', async () => {
    const state = { step: 'oldStep', customer: {} } as unknown as OrderState;
    const result = await runFlow(state, { ...hello, phone: '5500000000000' }, createFakeTools());
    expect(result.state).toEqual({ step: 'askName', customer: {} });
    expect(result.replies).toEqual([text(msg.welcomeNew)]);
  });

  it('avisa o callback com o ToolError quando uma ferramenta falha', async () => {
    const boom = new Error('RevGás fora do ar');
    const tools = createFakeTools({
      findCustomer: async () => {
        throw boom;
      },
    });
    const seen: ToolError[] = [];
    const result = await runFlow(null, hello, tools, error => seen.push(error));
    expect(result.replies).toEqual([text(msg.unavailable)]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(ToolError);
    expect(seen[0].cause).toBe(boom);
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
  'askCpfPrefix',
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
    expect(done).toEqual({ state: null, replies: [text(msg.saleCreated(4521))], saleId: 4521 });
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
    let createAttempts = 0;
    const sinceSeen: Date[] = [];
    const tools = createFakeTools({
      createSale: async () => {
        createAttempts += 1;
        throw new Error('timeout');
      },
      findRecentSale: async (_order, since) => {
        sinceSeen.push(since);
        return 9001;
      },
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
    expect(retried).toEqual({ state: null, replies: [text(msg.saleCreated(9001))], saleId: 9001 });
    expect(createAttempts).toBe(1);
    expect(sinceSeen).toEqual([FAKE_NOW]);
  });

  it('cancelar no meio encerra o pedido', async () => {
    const chat = new Conversation(createFakeTools());
    await chat.send(say('oi'));
    await chat.send(pick('address:0'));
    const cancelled = await chat.send(say('cancelar'));
    expect(cancelled).toEqual({ state: null, replies: [text(msg.cancelled)] });
  });
});

describe('cadastro sob runFlow', () => {
  const confirming = (): OrderState => ({
    step: 'confirmAddress',
    customer: { name: 'Maria da Silva', cpf: '12345678909' },
    draftAddress: {
      street: 'Rua das Flores',
      number: '120',
      neighborhood: 'Centro',
      city: 'Teresina',
      state: 'PI',
    },
  });

  it('CpfTakenError do createCustomer encerra com a mensagem de CPF já cadastrado', async () => {
    const tools = createFakeTools({
      createCustomer: async () => {
        throw new CpfTakenError();
      },
    });
    const result = await runFlow(confirming(), pick('address:ok'), tools);
    expect(result).toEqual({ state: null, replies: [text(msg.cpfTaken(tools.storePhone))] });
  });

  it('falha ao listar produtos depois de criar o cadastro não recria o cliente na próxima mensagem', async () => {
    let listFails = true;
    const tools = createFakeTools({
      listProducts: async () => {
        if (listFails) throw new Error('RevGás fora do ar');
        return [{ id: 1, name: 'Botijão P13' }];
      },
    });
    const first = await runFlow(confirming(), pick('address:ok'), tools);
    expect(first.replies).toEqual([text(msg.unavailable)]);
    expect(first.state?.customer.id).toBe(2);

    listFails = false;
    const second = await runFlow(
      first.state,
      { phone: FAKE_PHONE, content: { type: 'text', text: 'oi' } },
      tools,
    );
    expect(second.state?.step).toBe('chooseProduct');
    expect(second.replies.at(-1)?.type).toBe('list');
    expect(tools.calls.filter(call => call.name === 'createCustomer')).toHaveLength(1);
  });

  it('CustomerRejectedError do createCustomer volta para o nome', async () => {
    const tools = createFakeTools({
      createCustomer: async () => {
        throw new CustomerRejectedError();
      },
    });
    const result = await runFlow(confirming(), pick('address:ok'), tools);
    expect(result.state?.step).toBe('askName');
    expect(result.replies).toEqual([text(msg.registerFailed)]);
  });
});

describe('primeira mensagem com pedido', () => {
  const order = {
    intent: 'order' as const,
    products: ['Botijão P13'],
    quantity: 2,
    payment: 'PIX',
    confidence: 0.9,
  };
  it.each(['oi', 'Bom dia!', 'oi, boa tarde', 'E aí'])(
    'cumprimento (%s) não chama a IA e inicia o pedido',
    async greeting => {
      const tools = createFakeTools({ interpret: async () => order });
      const spy = vi.spyOn(tools, 'interpret');
      const chat = new Conversation(tools, '5586988887777');
      const result = await chat.send(say(greeting));
      expect(spy).not.toHaveBeenCalled();
      expect(result.replies).toEqual([text(msg.welcomeNew)]);
      expect(chat.state).toEqual({ step: 'askName', customer: {} });
    },
  );

  it('pedido na primeira mensagem chama a IA uma vez só', async () => {
    const tools = createFakeTools({ interpret: async () => order });
    const spy = vi.spyOn(tools, 'interpret');
    await new Conversation(tools, '5586988887777').send(say('quero 2 botijão P13 no pix'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('"outro" na primeira mensagem inicia o pedido como hoje', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'other', quantity: 2, confidence: 0.9 }),
    });
    const chat = new Conversation(tools, '5586988887777');
    const result = await chat.send(say('tudo bem com vocês'));
    expect(result.replies).toEqual([text(msg.welcomeNew)]);
    expect(chat.state).toEqual({ step: 'askName', customer: {} });
  });

  it('cliente novo com pedido completo', async () => {
    const tools = createFakeTools({ interpret: async () => order });
    const chat = new Conversation(tools, '5586988887777');
    const first = await chat.send(say('quero 2 botijão P13 no pix'));
    expect(first.replies[0]).toEqual(text(msg.welcomeNew));
    expect(first.replies[1]).toEqual(text(msg.noted(['2x Botijão P13', 'Pix'])));
    expect(chat.step).toBe('askName');
    expect(chat.state).toMatchObject({
      product: { id: 1 },
      quantity: 2,
      payment: { type: 'PIX' },
    });
    await chat.send(say('Maria da Silva'));
    await chat.send(say('123.456.789-09'));
    await chat.send(say('64000-000'));
    expect(chat.step).toBe('askAddressField');
    await chat.send(say('120'));
    expect(chat.step).toBe('confirmAddress');
    await chat.send(pick('address:ok'));
    expect(chat.step).toBe('summary');
  });

  it('cliente cadastrado com pedido completo', async () => {
    const tools = createFakeTools({ interpret: async () => order });
    const chat = new Conversation(tools);
    const first = await chat.send(say('quero 2 botijão P13 no pix'));
    expect(first.replies[0]).toEqual(text(msg.welcomeBack('Maria da Silva')));
    expect(first.replies[1]).toEqual(text(msg.noted(['2x Botijão P13', 'Pix'])));
    expect(chat.step).toBe('chooseAddress');
    await chat.send(pick('address:0'));
    expect(chat.step).toBe('summary');
  });

  it('cliente novo com endereço na primeira mensagem', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'order', address: 'Rua A, 10, Centro', confidence: 0.9 }),
    });
    const chat = new Conversation(tools, '5586988887777');
    await chat.send(say('entrega na Rua A, 10, Centro'));
    await chat.send(say('Maria da Silva'));
    await chat.send(say('123.456.789-09'));
    expect(chat.step).toBe('confirmAddress');
  });

  it('dúvida que a base não sabe: atendente e "Fazer pedido", sem iniciar o pedido', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'question', topic: 'general', confidence: 0.9 }),
    });
    const chat = new Conversation(tools, '5586988887777');
    const result = await chat.send(say('vocês entregam hoje? quero saber'));
    expect(result).toEqual({
      state: null,
      replies: [buttons(msg.notKnown, [handoffBtn, orderBtn])],
    });
    expect(tools.calls.map(call => call.name)).not.toContain('findCustomer');
  });

  it('dúvida com palavra de pedido na primeira mensagem é respondida, sem iniciar o pedido', async () => {
    const tools = createFakeTools({
      interpret: async () => ({
        intent: 'question',
        topic: 'general',
        products: ['Botijão P13'],
        confidence: 0.9,
      }),
      answerQuestion: async () => ({
        kind: 'answered',
        text: 'Cascos amassados podem ser recusados na troca.',
        sources: ['T1'],
      }),
    });
    const chat = new Conversation(tools, '5586988887777');
    const result = await chat.send(say('quero trocar o casco do botijão mas ele está danificado'));
    expect(result).toEqual({
      state: null,
      replies: [buttons('Cascos amassados podem ser recusados na troca.', [orderBtn])],
    });
    expect(chat.state).toBeNull();
    expect(tools.calls.map(call => call.name)).not.toContain('findCustomer');
  });

  it('dúvida respondida na primeira mensagem e depois "Fazer pedido"', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'question', topic: 'general', confidence: 0.9 }),
      answerQuestion: async () => ({
        kind: 'answered',
        text: 'Entregamos no Centro.',
        sources: ['T1'],
      }),
    });
    const spy = vi.spyOn(tools, 'answerQuestion');
    const chat = new Conversation(tools, '5586988887777');
    const result = await chat.send(say('entregam no centro?'));
    expect(result).toEqual({
      state: null,
      replies: [buttons('Entregamos no Centro.', [orderBtn])],
    });
    expect(spy).toHaveBeenCalledWith('entregam no centro?');
    await chat.send(pick(ORDER_START_CHOICE));
    expect(chat.step).toBe('askName');
  });

  it('preço na primeira mensagem pelo código, sem cotar', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'price', confidence: 0.9 }),
      basePrices: async () => [
        { product: { id: 1, name: 'Botijão P13' }, minPrice: 110, varies: false },
      ],
    });
    const chat = new Conversation(tools, '5586988887777');
    const result = await chat.send(say('quanto tá o gás?'));
    expect(result).toEqual({
      state: null,
      replies: [
        buttons('Preços de hoje:\n- Botijão P13: R$ 110,00\nO total aparece no resumo do pedido.', [
          orderBtn,
        ]),
      ],
    });
    expect(tools.calls.map(call => call.name)).not.toContain('quote');
  });

  it.each([
    ['off_topic', msg.offTopicRefusal],
    ['offense', msg.offense],
  ] as const)('%s na primeira mensagem não inicia o pedido', async (intent, body) => {
    const tools = createFakeTools({ interpret: async () => ({ intent, confidence: 0.9 }) });
    const chat = new Conversation(tools, '5586988887777');
    const result = await chat.send(say('qualquer coisa'));
    expect(result).toEqual({ state: null, replies: [buttons(body, [orderBtn])] });
  });

  it('produto que não vende na primeira mensagem', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'order', unknownProduct: 'carvão', confidence: 0.9 }),
    });
    const result = await new Conversation(tools, '5586988887777').send(say('quero carvão'));
    expect(result).toEqual({
      state: null,
      replies: [
        buttons('Não temos carvão. Temos: Botijão P13, Botijão P45 e Água mineral 20L.', [
          orderBtn,
        ]),
      ],
    });
  });

  it('primeira mensagem perguntando os assuntos: lista e "Fazer pedido", sem IA nem pedido', async () => {
    const tools = createFakeTools({ knowledgeTopics: async () => ['Troco'] });
    const spy = vi.spyOn(tools, 'interpret');
    const chat = new Conversation(tools, '5586988887777');
    const result = await chat.send(say('quais dúvidas posso tirar com você?'));
    expect(spy).not.toHaveBeenCalled();
    expect(result.replies).toEqual([
      buttons(
        msg.capabilities([
          'Horário de atendimento',
          'Formas de pagamento',
          'Preços dos produtos',
          'Troco',
        ]),
        [orderBtn],
      ),
    ]);
    expect(chat.state).toBeNull();
  });

  it('pedir atendente só pela IA na primeira mensagem oferece o botão, sem transferir', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'handoff', confidence: 0.9 }),
    });
    const result = await new Conversation(tools).send(say('preciso de uma pessoa'));
    expect(result).toEqual({
      state: null,
      replies: [buttons(msg.offerAgent, [handoffBtn, orderBtn])],
    });
    expect(tools.calls.map(call => call.name)).not.toContain('requestHandoff');
  });

  it('"atendente" digitado na primeira mensagem continua transferindo direto, sem IA', async () => {
    const tools = createFakeTools();
    const result = await new Conversation(tools).send(say('quero falar com um atendente'));
    expect(result).toEqual({ state: null, replies: [text(msg.handoffQueued)] });
    const names = tools.calls.map(call => call.name);
    expect(names).toContain('requestHandoff');
    expect(names).not.toContain('interpret');
  });

  it('primeira mensagem só com convite para perguntar: "Fazer pedido", sem IA nem pedido', async () => {
    const tools = createFakeTools();
    const chat = new Conversation(tools, '5586988887777');
    const result = await chat.send(say('tenho dúvidas'));
    expect(result).toEqual({ state: null, replies: [buttons(msg.questionInvite, [orderBtn])] });
    const names = tools.calls.map(call => call.name);
    expect(names).not.toContain('interpret');
    expect(names).not.toContain('answerQuestion');
    expect(names).not.toContain('findCustomer');
    expect(names).not.toContain('requestHandoff');
  });

  it('IA falhou na primeira mensagem', async () => {
    const tools = createFakeTools({ interpret: async () => null });
    const chat = new Conversation(tools, '5586988887777');
    const result = await chat.send(say('quero gás'));
    expect(result.replies).toEqual([text(msg.welcomeNew)]);
    expect(chat.state).toEqual({ step: 'askName', customer: {} });
  });
});

const handoffBtn = { id: HANDOFF_CHOICE, title: 'Falar com atendente' };
const orderBtn = { id: ORDER_START_CHOICE, title: 'Fazer pedido' };

describe('texto livre no meio do pedido', () => {
  const pix = { type: 'PIX', label: 'Pix' };
  const money = { type: 'MONEY', label: 'Dinheiro' };
  const credit = { type: 'CARTAO_DE_CREDITO', label: 'Cartão de crédito' };
  const paying: OrderState = {
    step: 'choosePayment',
    customer: { id: 1, name: 'Maria da Silva', cpfPrefix: '123', tagId: null },
    address: {
      street: 'Rua das Flores',
      number: '120',
      neighborhood: 'Centro',
      city: 'Teresina',
      state: 'PI',
    },
    product: { id: 2, name: 'Botijão P45' },
    quantity: 1,
    paymentOptions: [pix, money, credit],
  };
  const paymentButtons = buttons(
    msg.choosePayment,
    [pix, money, credit].map(option => ({ id: `pay:${option.type}`, title: option.label })),
  );
  const names = (tools: FakeTools) => tools.calls.map(call => call.name);

  it('"quanto tá o P13" responde o preço e não troca o produto', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'price', products: ['Botijão P13'], confidence: 0.9 }),
      basePrices: async () => [
        { product: { id: 1, name: 'Botijão P13' }, minPrice: 110, varies: false },
        { product: { id: 2, name: 'Botijão P45' }, minPrice: 400, varies: false },
      ],
      quote: async () => ({ unitPrice: 999, total: 999 }),
    });
    const result = await runFlow(paying, say('quanto tá o P13?'), tools);
    expect(result.state).toEqual(paying);
    expect(result.replies).toEqual([
      text('Preços de hoje:\n- Botijão P13: R$ 110,00\nO total aparece no resumo do pedido.'),
      paymentButtons,
    ]);
  });

  it('dúvida que a base não sabe: oferta antes da pergunta e estado igual', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'question', topic: 'general', confidence: 0.9 }),
    });
    const result = await runFlow(paying, say('vocês entregam domingo?'), tools);
    expect(result).toEqual({ state: paying, replies: [offer(msg.notKnown), paymentButtons] });
  });

  it('convite para perguntar: texto fixo, sem IA, sem base, e repete a pergunta', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'other', confidence: 0.9 }),
    });
    const result = await runFlow(paying, say('quero que você tire dúvidas comigo'), tools);
    expect(result).toEqual({
      state: paying,
      replies: [text(msg.questionInvite), paymentButtons],
    });
    expect(names(tools)).not.toContain('interpret');
    expect(names(tools)).not.toContain('answerQuestion');
    expect(names(tools)).toContain('resetMisunderstood');
  });

  it('convite que só a IA reconhece também responde fixo', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'question', topic: 'invite', confidence: 0.9 }),
    });
    const result = await runFlow(
      paying,
      say('me ajuda com umas coisas que eu queria saber?'),
      tools,
    );
    expect(result).toEqual({
      state: paying,
      replies: [text(msg.questionInvite), paymentButtons],
    });
    expect(names(tools)).not.toContain('answerQuestion');
  });

  it('"não quero tirar minhas dúvidas" em askNeedsChange não transfere mesmo se a IA disser handoff', async () => {
    const needsChange: OrderState = { ...paying, step: 'askNeedsChange', payment: money };
    const asked = await asks.askNeedsChange?.(needsChange, createFakeTools());
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'handoff', confidence: 0.9 }),
    });
    const result = await runFlow(needsChange, say('não quero tirar minhas dúvidas'), tools);
    expect(names(tools)).not.toContain('requestHandoff');
    expect(result.state).toEqual(needsChange);
    expect(result.replies).toEqual([offer(msg.offerAgent), ...(asked?.replies ?? [])]);
  });

  it('taxa de entrega no meio do pedido: texto fixo com oferta e estado igual', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'price', topic: 'delivery_fee', confidence: 0.9 }),
    });
    const result = await runFlow(paying, say('qual o valor da entrega?'), tools);
    expect(result).toEqual({ state: paying, replies: [offer(msg.deliveryFee), paymentButtons] });
  });

  it('mensagem entendida zera o contador de "não entendi"', async () => {
    const tools = createFakeTools();
    await runFlow(paying, pick('pay:PIX'), tools);
    expect(names(tools)).toContain('resetMisunderstood');
  });

  it('"não entendi" conta e não zera', async () => {
    const tools = createFakeTools();
    const result = await runFlow(paying, say('blá blá'), tools);
    expect(result.replies).toEqual([text(msg.notUnderstood), paymentButtons]);
    expect(names(tools)).toContain('registerMisunderstood');
    expect(names(tools)).not.toContain('resetMisunderstood');
  });

  it('3º "não entendi" seguido oferece o atendente', async () => {
    const tools = createFakeTools({ registerMisunderstood: async () => 3 });
    const result = await runFlow(paying, say('blá blá'), tools);
    expect(result.replies).toEqual([offer(msg.stuck), paymentButtons]);
    expect(result.state).toEqual(paying);
  });

  it('comando global também zera o contador', async () => {
    const tools = createFakeTools();
    await runFlow(paying, say('cancelar'), tools);
    expect(names(tools)).toContain('resetMisunderstood');
  });

  it('mensagem que não é texto nem botão não zera o contador', async () => {
    const tools = createFakeTools();
    await runFlow(paying, { phone: FAKE_PHONE, content: { type: 'unsupported' } }, tools);
    expect(names(tools)).not.toContain('resetMisunderstood');
  });

  it('falha ao zerar o contador não derruba a resposta', async () => {
    const seen: ToolError[] = [];
    const tools = createFakeTools({
      resetMisunderstood: async () => {
        throw new Error('Redis fora do ar');
      },
    });
    const result = await runFlow(paying, pick('pay:PIX'), tools, error => seen.push(error));
    expect(result.state?.step).toBe('summary');
    expect(seen).toEqual([]);
  });

  it('dúvida sem pedido em andamento também zera o contador', async () => {
    const tools = createFakeTools({
      interpret: async () => ({ intent: 'off_topic', confidence: 0.9 }),
    });
    await runFlow(null, say('receita de bolo'), tools);
    expect(names(tools)).toContain('resetMisunderstood');
  });
});

describe('identidade antes dos dados do cliente', () => {
  const say = (body: string): FlowInput => ({
    phone: FAKE_PHONE,
    content: { type: 'text', text: body },
  });
  const secrets = ['Maria', 'Rua das Flores', 'Av. Frei Serafim'];
  const expectHidden = (result: StepResult) => {
    const sent = JSON.stringify(result.replies);
    for (const secret of secrets) expect(sent).not.toContain(secret);
  };

  it('não mostra nome nem endereço até os 3 dígitos serem confirmados', async () => {
    const tools = createFakeTools({ isVerified: async () => false });
    const first = await runFlow(null, hello, tools);
    expectHidden(first);
    expect(first.state?.step).toBe('askCpfPrefix');

    const wrong = await runFlow(first.state, say('999'), tools);
    expectHidden(wrong);

    const order = await runFlow(wrong.state, say('quero 1 botijão P13'), tools);
    expectHidden(order);
    expect(tools.calls.map(call => call.name)).not.toContain('customerHistory');

    const right = await runFlow(order.state, say('123'), tools);
    expect(JSON.stringify(right.replies)).toContain('Maria');
  });
});
