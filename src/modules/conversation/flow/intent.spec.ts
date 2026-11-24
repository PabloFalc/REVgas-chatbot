import type { Interpretation } from 'src/modules/assistant/contracts/assistant.types';
import type { BasePrice } from 'src/modules/catalog/contracts/catalog.types';
import type { ServiceWindow } from 'src/utils/service-hours';
import { describe, expect, it, vi } from 'vitest';
import type { FlowTools, OrderState } from './flow.types';
import { HANDOFF_CHOICE, ORDER_START_CHOICE, offer } from './handoff';
import { routeIntent } from './intent';
import { msg } from './messages';
import { buttons, text } from './replies';
import './steps';
import { createFakeTools } from './testing/fake-tools';

const p13 = { id: 1, name: 'Botijão P13' };
const p45 = { id: 2, name: 'Botijão P45' };
const pix = { type: 'PIX', label: 'Pix' };
const money = { type: 'MONEY', label: 'Dinheiro' };
const credit = { type: 'CARTAO_DE_CREDITO', label: 'Cartão de crédito' };

const address = {
  street: 'Rua das Flores',
  number: '120',
  neighborhood: 'Centro',
  city: 'Teresina',
  state: 'PI',
};

const paying: OrderState = {
  step: 'choosePayment',
  customer: { id: 1, name: 'Maria da Silva', cpfPrefix: '123', tagId: null },
  address,
  product: p45,
  quantity: 1,
  paymentOptions: [pix, money, credit],
};

const paymentButtons = buttons(
  msg.choosePayment,
  [pix, money, credit].map(option => ({ id: `pay:${option.type}`, title: option.label })),
);

const handoffBtn = { id: HANDOFF_CHOICE, title: 'Falar com atendente' };
const orderBtn = { id: ORDER_START_CHOICE, title: 'Fazer pedido' };

const weekdays: ServiceWindow[] = [1, 2, 3, 4, 5].map(day => ({ day, start: 480, end: 1080 }));
const saturday: ServiceWindow = { day: 6, start: 480, end: 720 };

const prices: BasePrice[] = [
  { product: p13, minPrice: 110, varies: false },
  { product: p45, minPrice: 400, varies: true },
];

const ALL_PRICES =
  'Preços de hoje:\n- Botijão P13: R$ 110,00\n- Botijão P45: a partir de R$ 400,00\nO total aparece no resumo do pedido.';

function result(partial: Partial<Interpretation>): Interpretation {
  return { intent: 'order', confidence: 0.9, ...partial };
}

function names(tools: { calls: { name: string }[] }): string[] {
  return tools.calls.map(call => call.name);
}

describe('offer', () => {
  it('é uma mensagem de botões com o botão do atendente', () => {
    expect(offer(msg.notKnown)).toEqual(buttons(msg.notKnown, [handoffBtn]));
  });
});

describe('textos fixos da etapa B', () => {
  it('textos', () => {
    expect(msg.offTopicRefusal).toBe(
      'Sou o assistente da revenda: posso te ajudar com pedidos e dúvidas sobre gás e entrega.',
    );
    expect(msg.capabilities(['Troco', 'Vale-gás'])).toBe(
      'Posso tirar dúvidas sobre:\n- Troco\n- Vale-gás\nÉ só perguntar.',
    );
    expect(msg.offense).toBe(
      'Vamos manter a conversa respeitosa. Posso te ajudar com seu pedido de gás.',
    );
    expect(msg.notKnown).toBe('Não tenho essa informação. Quer falar com um atendente?');
    expect(msg.stuck).toBe('Não estou conseguindo entender. Quer falar com um atendente?');
    expect(msg.noServiceHours).toBe(
      'Não tenho o horário de atendimento cadastrado aqui. Quer falar com um atendente?',
    );
    expect(msg.noPrice).toBe(
      'Não consegui consultar os preços agora. Quer falar com um atendente?',
    );
    expect(msg.questionInvite).toBe(
      'Claro! Pode perguntar. Consigo te ajudar com horário, entrega, formas de pagamento, vale-gás, troca de botijão e segurança.',
    );
    expect(msg.offerAgent).toBe('Se quiser falar com um atendente, é só tocar no botão.');
    expect(msg.deliveryFee).toBe(
      'Não tenho o valor da entrega por aqui. O resumo do pedido mostra o total antes de você confirmar. Quer falar com um atendente?',
    );
  });

  it('horário agrupa dias seguidos com o mesmo horário', () => {
    expect(msg.serviceHours([...weekdays, saturday], true)).toBe(
      'Nosso horário de atendimento: seg a sex, 08:00 às 18:00; sáb, 08:00 às 12:00.\nEstamos abertos agora.',
    );
    expect(msg.serviceHours([saturday], false)).toBe(
      'Nosso horário de atendimento: sáb, 08:00 às 12:00.\nEstamos fechados agora.',
    );
  });

  it('horário com intervalo de almoço, dias soltos e domingo no fim', () => {
    const windows: ServiceWindow[] = [
      { day: 0, start: 420, end: 660 },
      { day: 1, start: 480, end: 720 },
      { day: 1, start: 840, end: 1080 },
      { day: 2, start: 480, end: 720 },
      { day: 2, start: 840, end: 1080 },
      { day: 4, start: 480, end: 720 },
      { day: 6, start: 420, end: 660 },
    ];
    expect(msg.serviceHours(windows, true)).toBe(
      'Nosso horário de atendimento: seg e ter, 08:00 às 12:00 e 14:00 às 18:00; qui, 08:00 às 12:00; sáb e dom, 07:00 às 11:00.\nEstamos abertos agora.',
    );
  });

  it('pagamento lista os rótulos na ordem', () => {
    expect(msg.paymentsAccepted(['Pix', 'Dinheiro', 'Cartão de crédito'])).toBe(
      'Aceitamos: Pix, Dinheiro e Cartão de crédito.',
    );
    expect(msg.paymentsAccepted(['Pix'])).toBe('Aceitamos: Pix.');
  });

  it('preço', () => {
    expect(msg.prices(prices)).toBe(ALL_PRICES);
  });

  it('produto que não vende', () => {
    expect(msg.notSold('carvão', ['P13', 'P45', 'Água 20L'])).toBe(
      'Não temos carvão. Temos: P13, P45 e Água 20L.',
    );
    expect(msg.notSold(null, ['P13'])).toBe('Não temos esse produto. Temos: P13.');
  });
});

describe('routeIntent com pedido em andamento', () => {
  const route = (interpretation: Interpretation, tools: FlowTools, raw = 'texto do cliente') =>
    routeIntent(paying, interpretation, raw, tools);

  it('dúvida respondida: resposta, pergunta da etapa repetida e estado igual', async () => {
    const tools = createFakeTools({
      answerQuestion: async () => ({
        kind: 'answered',
        text: 'Entregamos em até 1 hora.',
        sources: ['T1'],
      }),
    });
    const spy = vi.spyOn(tools, 'answerQuestion');
    const out = await route(
      result({ intent: 'question', topic: 'general' }),
      tools,
      'entregam rápido?',
    );
    expect(spy).toHaveBeenCalledWith('entregam rápido?');
    expect(out).toEqual({
      state: paying,
      replies: [text('Entregamos em até 1 hora.'), paymentButtons],
    });
  });

  it('dúvida sem tópico vai para a base', async () => {
    const tools = createFakeTools();
    await route(result({ intent: 'question' }), tools);
    expect(names(tools)).toContain('answerQuestion');
  });

  it('"não sei" oferece o atendente antes da pergunta', async () => {
    const tools = createFakeTools();
    const out = await route(result({ intent: 'question', topic: 'general' }), tools);
    expect(out).toEqual({ state: paying, replies: [offer(msg.notKnown), paymentButtons] });
  });

  it('horário pelo código', async () => {
    const tools = createFakeTools({
      serviceHours: async () => ({
        open: false,
        nextOpening: null,
        windows: [...weekdays, saturday],
      }),
    });
    const out = await route(result({ intent: 'question', topic: 'hours' }), tools);
    expect(out?.replies).toEqual([
      text(msg.serviceHours([...weekdays, saturday], false)),
      paymentButtons,
    ]);
    expect(out?.state).toEqual(paying);
    expect(names(tools)).not.toContain('answerQuestion');
  });

  it('horário sem janelas oferece o atendente', async () => {
    const out = await route(result({ intent: 'question', topic: 'hours' }), createFakeTools());
    expect(out?.replies).toEqual([offer(msg.noServiceHours), paymentButtons]);
  });

  it('pagamento pelo código', async () => {
    const tools = createFakeTools();
    const out = await route(result({ intent: 'question', topic: 'payments' }), tools);
    expect(out?.replies).toEqual([
      text('Aceitamos: Pix, Dinheiro e Cartão de crédito.'),
      paymentButtons,
    ]);
    expect(names(tools)).not.toContain('answerQuestion');
  });

  it('preço pela tabela base, nunca pela cotação do cliente', async () => {
    const tools = createFakeTools({
      basePrices: async () => prices,
      quote: async () => ({ unitPrice: 999, total: 999 }),
    });
    const out = await route(result({ intent: 'price' }), tools);
    expect(out).toEqual({ state: paying, replies: [text(ALL_PRICES), paymentButtons] });
  });

  it('"quanto tá o P13" mostra só o P13 e não troca o produto', async () => {
    const tools = createFakeTools({ basePrices: async () => prices });
    const out = await route(result({ intent: 'price', products: ['botijao p13'] }), tools);
    expect(out?.replies[0]).toEqual(
      text('Preços de hoje:\n- Botijão P13: R$ 110,00\nO total aparece no resumo do pedido.'),
    );
    expect(out?.state).toEqual(paying);
    expect(out?.state?.product).toEqual(p45);
  });

  it('preço de produto fora do catálogo mostra todos', async () => {
    const tools = createFakeTools({ basePrices: async () => prices });
    const out = await route(result({ intent: 'price', products: ['Lenha'] }), tools);
    expect(out?.replies[0]).toEqual(text(ALL_PRICES));
  });

  it('sem preço oferece o atendente', async () => {
    const out = await route(result({ intent: 'price' }), createFakeTools());
    expect(out?.replies).toEqual([offer(msg.noPrice), paymentButtons]);
  });

  it('assuntos: lista do código e da base, sem passar pela busca, e repete a pergunta', async () => {
    const tools = createFakeTools({
      knowledgeTopics: async () => ['Bairros atendidos', 'Vale-gás', 'Formas de pagamento'],
    });
    const out = await route(result({ intent: 'question', topic: 'capabilities' }), tools);
    expect(out).toEqual({
      state: paying,
      replies: [
        text(
          msg.capabilities([
            'Horário de atendimento',
            'Formas de pagamento',
            'Preços dos produtos',
            'Bairros atendidos',
            'Vale-gás',
          ]),
        ),
        paymentButtons,
      ],
    });
    expect(names(tools)).not.toContain('answerQuestion');
  });

  it('assuntos sem a base mostram só o que o código responde', async () => {
    const out = await route(
      result({ intent: 'question', topic: 'capabilities' }),
      createFakeTools(),
    );
    expect(out?.replies[0]).toEqual(
      text(
        msg.capabilities(['Horário de atendimento', 'Formas de pagamento', 'Preços dos produtos']),
      ),
    );
  });

  it('fora do assunto recusa e repete a pergunta', async () => {
    const out = await route(result({ intent: 'off_topic' }), createFakeTools());
    expect(out).toEqual({
      state: paying,
      replies: [text(msg.offTopicRefusal), paymentButtons],
    });
  });

  it('ofensa 1ª: texto neutro e pergunta', async () => {
    const tools = createFakeTools();
    const out = await route(result({ intent: 'offense' }), tools);
    expect(names(tools)).toContain('registerOffense');
    expect(out).toEqual({ state: paying, replies: [text(msg.offense), paymentButtons] });
  });

  it('ofensa 2ª: oferece o atendente', async () => {
    const tools = createFakeTools({ registerOffense: async () => 2 });
    const out = await route(result({ intent: 'offense' }), tools);
    expect(out).toEqual({ state: paying, replies: [offer(msg.offense), paymentButtons] });
  });

  it('pedido de atendente só pela IA oferece o botão, não transfere, e repete a pergunta', async () => {
    const tools = createFakeTools();
    const spy = vi.spyOn(tools, 'requestHandoff');
    const out = await route(result({ intent: 'handoff' }), tools, 'não quero tirar minhas dúvidas');
    expect(spy).not.toHaveBeenCalled();
    expect(out).toEqual({ state: paying, replies: [offer(msg.offerAgent), paymentButtons] });
  });

  it('convite para perguntar responde fixo, sem base nem atendente, e repete a pergunta', async () => {
    const tools = createFakeTools();
    const out = await route(result({ intent: 'question', topic: 'invite' }), tools);
    expect(out).toEqual({ state: paying, replies: [text(msg.questionInvite), paymentButtons] });
    expect(names(tools)).not.toContain('answerQuestion');
    expect(names(tools)).not.toContain('requestHandoff');
  });

  it('taxa de entrega pelo código: texto fixo com oferta, sem preço nem base', async () => {
    const tools = createFakeTools({ basePrices: async () => prices });
    const out = await route(result({ intent: 'price', topic: 'delivery_fee' }), tools);
    expect(out).toEqual({ state: paying, replies: [offer(msg.deliveryFee), paymentButtons] });
    expect(names(tools)).not.toContain('basePrices');
    expect(names(tools)).not.toContain('answerQuestion');
  });

  it('produto que não vende lista o catálogo do cliente', async () => {
    const tools = createFakeTools();
    const spy = vi.spyOn(tools, 'listProducts');
    const out = await route(result({ unknownProduct: 'carvão' }), tools);
    expect(spy).toHaveBeenCalledWith({ id: 1, tagId: null });
    expect(out).toEqual({
      state: paying,
      replies: [
        text('Não temos carvão. Temos: Botijão P13, Botijão P45 e Água mineral 20L.'),
        paymentButtons,
      ],
    });
  });

  it('produto que não vende limpa o nome vindo da IA', async () => {
    const out = await route(
      result({ unknownProduct: ' <b>carvão!!</b>   vegetal-fino; DROP * ' }),
      createFakeTools(),
    );
    expect(out?.replies[0]).toEqual(
      text(
        'Não temos bcarvãob vegetal-fino DROP. Temos: Botijão P13, Botijão P45 e Água mineral 20L.',
      ),
    );
  });

  it('produto que não vende com nome longo é cortado em 30 caracteres', async () => {
    const out = await route(result({ unknownProduct: 'a'.repeat(50) }), createFakeTools());
    expect(out?.replies[0]).toEqual(
      text(`Não temos ${'a'.repeat(30)}. Temos: Botijão P13, Botijão P45 e Água mineral 20L.`),
    );
  });

  it('produto que não vende sem nome aproveitável', async () => {
    const out = await route(result({ unknownProduct: '!!!' }), createFakeTools());
    expect(out?.replies[0]).toEqual(
      text('Não temos esse produto. Temos: Botijão P13, Botijão P45 e Água mineral 20L.'),
    );
  });

  it('produto que não vende junto com um que vende segue o pedido', async () => {
    const out = await route(
      result({ unknownProduct: 'carvão', products: ['Botijão P13'] }),
      createFakeTools(),
    );
    expect(out).toBeNull();
  });

  it.each([result({ quantity: 2 }), result({ intent: 'other' })])(
    'pedido e outro devolvem null (%j)',
    async interpretation => {
      expect(await route(interpretation, createFakeTools())).toBeNull();
    },
  );
});

describe('routeIntent sem pedido em andamento', () => {
  const route = (interpretation: Interpretation, tools: FlowTools, raw = 'texto do cliente') =>
    routeIntent(null, interpretation, raw, tools);

  it('dúvida respondida com botão "Fazer pedido"', async () => {
    const tools = createFakeTools({
      answerQuestion: async () => ({
        kind: 'answered',
        text: 'Entregamos no bairro.',
        sources: ['T1'],
      }),
    });
    const spy = vi.spyOn(tools, 'answerQuestion');
    const out = await route(
      result({ intent: 'question', topic: 'general' }),
      tools,
      'entrega no centro?',
    );
    expect(spy).toHaveBeenCalledWith('entrega no centro?');
    expect(out).toEqual({
      state: null,
      replies: [buttons('Entregamos no bairro.', [orderBtn])],
    });
  });

  it('"não sei" junta atendente e "Fazer pedido" numa mensagem', async () => {
    const out = await route(result({ intent: 'question', topic: 'general' }), createFakeTools());
    expect(out).toEqual({
      state: null,
      replies: [buttons(msg.notKnown, [handoffBtn, orderBtn])],
    });
  });

  it('horário', async () => {
    const tools = createFakeTools({
      serviceHours: async () => ({ open: true, nextOpening: null, windows: weekdays }),
    });
    const out = await route(result({ intent: 'question', topic: 'hours' }), tools);
    expect(out).toEqual({
      state: null,
      replies: [buttons(msg.serviceHours(weekdays, true), [orderBtn])],
    });
  });

  it('horário sem janelas', async () => {
    const out = await route(result({ intent: 'question', topic: 'hours' }), createFakeTools());
    expect(out?.replies).toEqual([buttons(msg.noServiceHours, [handoffBtn, orderBtn])]);
  });

  it('pagamento', async () => {
    const out = await route(result({ intent: 'question', topic: 'payments' }), createFakeTools());
    expect(out?.replies).toEqual([
      buttons('Aceitamos: Pix, Dinheiro e Cartão de crédito.', [orderBtn]),
    ]);
  });

  it('preço sem cotar', async () => {
    const tools = createFakeTools({ basePrices: async () => prices });
    const out = await route(result({ intent: 'price', products: ['Botijão P45'] }), tools);
    expect(out).toEqual({
      state: null,
      replies: [
        buttons(
          'Preços de hoje:\n- Botijão P45: a partir de R$ 400,00\nO total aparece no resumo do pedido.',
          [orderBtn],
        ),
      ],
    });
    expect(names(tools)).not.toContain('quote');
  });

  it('sem preço', async () => {
    const out = await route(result({ intent: 'price' }), createFakeTools());
    expect(out?.replies).toEqual([buttons(msg.noPrice, [handoffBtn, orderBtn])]);
  });

  it('assuntos sem pedido: lista com "Fazer pedido"', async () => {
    const tools = createFakeTools({ knowledgeTopics: async () => ['Troco'] });
    const out = await route(result({ intent: 'question', topic: 'capabilities' }), tools);
    expect(out).toEqual({
      state: null,
      replies: [
        buttons(
          msg.capabilities([
            'Horário de atendimento',
            'Formas de pagamento',
            'Preços dos produtos',
            'Troco',
          ]),
          [orderBtn],
        ),
      ],
    });
  });

  it('fora do assunto', async () => {
    const out = await route(result({ intent: 'off_topic' }), createFakeTools());
    expect(out).toEqual({ state: null, replies: [buttons(msg.offTopicRefusal, [orderBtn])] });
  });

  it('ofensa 1ª e 2ª', async () => {
    const first = await route(result({ intent: 'offense' }), createFakeTools());
    expect(first?.replies).toEqual([buttons(msg.offense, [orderBtn])]);
    const second = await route(
      result({ intent: 'offense' }),
      createFakeTools({ registerOffense: async () => 3 }),
    );
    expect(second?.replies).toEqual([buttons(msg.offense, [handoffBtn, orderBtn])]);
  });

  it('pedido de atendente só pela IA oferece atendente e "Fazer pedido", sem transferir', async () => {
    const tools = createFakeTools();
    const spy = vi.spyOn(tools, 'requestHandoff');
    const out = await route(result({ intent: 'handoff' }), tools);
    expect(spy).not.toHaveBeenCalled();
    expect(out).toEqual({
      state: null,
      replies: [buttons(msg.offerAgent, [handoffBtn, orderBtn])],
    });
  });

  it('convite para perguntar sem pedido: texto fixo com "Fazer pedido"', async () => {
    const tools = createFakeTools();
    const out = await route(result({ intent: 'question', topic: 'invite' }), tools);
    expect(out).toEqual({ state: null, replies: [buttons(msg.questionInvite, [orderBtn])] });
    expect(names(tools)).toEqual([]);
  });

  it('taxa de entrega sem pedido: texto fixo com atendente e "Fazer pedido"', async () => {
    const out = await route(result({ intent: 'price', topic: 'delivery_fee' }), createFakeTools());
    expect(out).toEqual({
      state: null,
      replies: [buttons(msg.deliveryFee, [handoffBtn, orderBtn])],
    });
  });

  it('produto que não vende usa o catálogo base', async () => {
    const tools = createFakeTools();
    const spy = vi.spyOn(tools, 'listProducts');
    const out = await route(result({ unknownProduct: 'carvão' }), tools);
    expect(spy).toHaveBeenCalledWith({});
    expect(out).toEqual({
      state: null,
      replies: [
        buttons('Não temos carvão. Temos: Botijão P13, Botijão P45 e Água mineral 20L.', [
          orderBtn,
        ]),
      ],
    });
  });

  it('resposta acima do limite dos botões vai em texto e os botões vêm em seguida', async () => {
    const many: BasePrice[] = Array.from({ length: 40 }, (_, index) => ({
      product: { id: index + 10, name: `Produto de nome bem comprido número ${index}` },
      minPrice: 100 + index,
      varies: false,
    }));
    const tools = createFakeTools({ basePrices: async () => many });
    const out = await route(result({ intent: 'price' }), tools);
    const body = msg.prices(many);
    expect(body.length).toBeGreaterThan(1024);
    expect(out).toEqual({
      state: null,
      replies: [text(body), buttons(msg.wantToOrder, [orderBtn])],
    });
  });

  it('resposta no limite dos botões continua numa mensagem só', async () => {
    const answer = 'a'.repeat(1024);
    const tools = createFakeTools({
      answerQuestion: async () => ({ kind: 'answered', text: answer, sources: ['T1'] }),
    });
    const out = await route(result({ intent: 'question', topic: 'general' }), tools);
    expect(out?.replies).toEqual([buttons(answer, [orderBtn])]);
  });

  it('pedido devolve null', async () => {
    expect(await route(result({ products: ['Botijão P13'] }), createFakeTools())).toBeNull();
  });
});
