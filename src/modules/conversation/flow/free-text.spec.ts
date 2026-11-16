import type { Interpretation } from 'src/modules/assistant/contracts/assistant.types';
import { describe, expect, it, vi } from 'vitest';
import type { FlowTools, OrderState } from './flow.types';
import {
  applyInterpretation,
  type Catalog,
  freeText,
  isGreetingOnly,
  keepOfferedProduct,
  looksLikeOrder,
  seedFromInterpretation,
  shouldInterpret,
} from './free-text';
import { offer } from './handoff';
import { msg } from './messages';
import { buttons, text } from './replies';
import './steps';
import { createFakeTools, type FakeTools } from './testing/fake-tools';

const p13 = { id: 1, name: 'Botijão P13' };
const p45 = { id: 2, name: 'Botijão P45' };
const water = { id: 3, name: 'Água mineral 20L' };
const pix = { type: 'PIX', label: 'Pix' };
const money = { type: 'MONEY', label: 'Dinheiro' };
const credit = { type: 'CARTAO_DE_CREDITO', label: 'Cartão de crédito' };

const catalog: Catalog = { products: [p13, p45, water], payments: [pix, money, credit] };

const address = {
  street: 'Rua das Flores',
  number: '120',
  neighborhood: 'Centro',
  city: 'Teresina',
  state: 'PI',
};

function result(partial: Partial<Interpretation>): Interpretation {
  return { intent: 'order', confidence: 0.9, ...partial };
}

describe('looksLikeOrder', () => {
  it.each(['quero 2 botijão no pix', 'Joao 13', 'manda gás', 'entrega na casa da minha mãe'])(
    'true: %s',
    text => {
      expect(looksLikeOrder(text)).toBe(true);
    },
  );

  it.each(['oi', 'Maria da Silva', 'kkkk', 'bom dia'])('false: %s', text => {
    expect(looksLikeOrder(text)).toBe(false);
  });
});

describe('shouldInterpret', () => {
  it.each(['123.456', '12 3', 'R$ 100,00', '?!', 'a 1 b 2', ''])('false: %j', text => {
    expect(shouldInterpret(text)).toBe(false);
  });

  it.each(['quero 3 botijões', 'paga no pix', 'abc', 'vocês abrem domingo?', 'quanto tá o P13'])(
    'true: %s',
    text => {
      expect(shouldInterpret(text)).toBe(true);
    },
  );
});

describe('isGreetingOnly', () => {
  it.each([
    'oi',
    'Oi!',
    'Olá',
    'bom dia',
    'Boa tarde, oi',
    'boa noite!!',
    'E aí?',
    'eai',
    'opa',
    'MENU',
  ])('true: %s', text => {
    expect(isGreetingOnly(text)).toBe(true);
  });

  it.each(['oi, quero gás', 'bom dia, vocês abrem domingo?', 'kkkk', 'oie', '', '!!'])(
    'false: %j',
    text => {
      expect(isGreetingOnly(text)).toBe(false);
    },
  );
});

describe('applyInterpretation', () => {
  it('aplica produto, quantidade e pagamento', () => {
    const state: OrderState = {
      step: 'summary',
      customer: {},
      product: p45,
      quantity: 1,
      payment: money,
      quote: { unitPrice: 200, total: 200 },
      changeFor: 300,
    };
    const applied = applyInterpretation(
      state,
      result({ products: ['botijao p13'], quantity: 3, payment: 'PIX' }),
      catalog,
    );
    expect(applied?.state.product).toEqual(p13);
    expect(applied?.state.quantity).toBe(3);
    expect(applied?.state.payment).toEqual(pix);
    expect(applied?.state.quote).toBeUndefined();
    expect(applied?.state.changeFor).toBeUndefined();
    expect(applied?.notes).toEqual(['3x Botijão P13', 'Pix']);
  });

  it('troca só a quantidade e mantém o produto', () => {
    const state: OrderState = { step: 'summary', customer: {}, product: p45, quantity: 1 };
    const applied = applyInterpretation(state, result({ quantity: 3 }), catalog);
    expect(applied?.state.quantity).toBe(3);
    expect(applied?.state.product).toEqual(p45);
    expect(applied?.notes).toEqual(['3x Botijão P45']);
  });

  it('troca só o produto e limpa a quantidade', () => {
    const state: OrderState = { step: 'summary', customer: {}, product: p13, quantity: 2 };
    const applied = applyInterpretation(state, result({ products: ['Botijão P45'] }), catalog);
    expect(applied?.state.product).toEqual(p45);
    expect(applied?.state.quantity).toBeUndefined();
    expect(applied?.notes).toEqual(['Botijão P45']);
  });

  it('repetir o produto do pedido mantém quantidade e cotação', () => {
    const state: OrderState = {
      step: 'summary',
      customer: {},
      product: p13,
      quantity: 2,
      quote: { unitPrice: 100, total: 200 },
    };
    const applied = applyInterpretation(
      state,
      result({ products: ['Botijão P13'], payment: 'PIX' }),
      catalog,
    );
    expect(applied?.state.product).toEqual(p13);
    expect(applied?.state.quantity).toBe(2);
    expect(applied?.notes).toEqual(['Pix']);
  });

  it('ambíguo com o produto atual entre os candidatos mantém o atual', () => {
    const state: OrderState = { step: 'summary', customer: {}, product: p13, quantity: 2 };
    const applied = applyInterpretation(
      state,
      result({ products: ['Botijão P13', 'Botijão P45'] }),
      catalog,
    );
    expect(applied).toBeNull();
  });

  it('ambíguo com o produto atual mantém o atual e aplica o resto', () => {
    const state: OrderState = { step: 'summary', customer: {}, product: p13, quantity: 2 };
    const applied = applyInterpretation(
      state,
      result({ products: ['Botijão P13', 'Botijão P45'], payment: 'PIX' }),
      catalog,
    );
    expect(applied?.state.product).toEqual(p13);
    expect(applied?.state.productCandidates).toBeUndefined();
    expect(applied?.state.quantity).toBe(2);
    expect(applied?.notes).toEqual(['Pix']);
  });

  it('produto ambíguo vira candidatos', () => {
    const state: OrderState = { step: 'chooseProduct', customer: {} };
    const applied = applyInterpretation(
      state,
      result({ products: ['Botijão P13', 'Botijão P45'], quantity: 3 }),
      catalog,
    );
    expect(applied?.state.product).toBeUndefined();
    expect(applied?.state.productCandidates).toEqual([p13, p45]);
    expect(applied?.state.quantity).toBe(3);
    expect(applied?.notes).toEqual([]);
  });

  it('descarta produto e pagamento fora do catálogo', () => {
    const state: OrderState = { step: 'chooseProduct', customer: {} };
    const applied = applyInterpretation(
      state,
      result({ products: ['Lenha'], payment: 'BITCOIN' }),
      catalog,
    );
    expect(applied).toBeNull();
  });

  it('endereço em texto', () => {
    const state: OrderState = {
      step: 'summary',
      customer: {},
      address,
      draftAddress: address,
      missingField: 'number',
    };
    const applied = applyInterpretation(state, result({ address: 'rua X, 10' }), catalog);
    expect(applied?.state.address).toBeUndefined();
    expect(applied?.state.draftAddress).toBeUndefined();
    expect(applied?.state.missingField).toBeUndefined();
    expect(applied?.state.pendingAddressText).toBe('rua X, 10');
    expect(applied?.notes).toEqual(['entrega em outro endereço']);
  });

  it('outro endereço sem texto', () => {
    const state: OrderState = {
      step: 'summary',
      customer: {},
      address,
      pendingAddressText: 'antigo',
    };
    const applied = applyInterpretation(state, result({ newAddress: true }), catalog);
    expect(applied?.state.address).toBeUndefined();
    expect(applied?.state.pendingAddressText).toBeUndefined();
    expect(applied?.notes).toEqual(['entrega em outro endereço']);
  });

  it('sem nenhum campo válido devolve null', () => {
    const state: OrderState = { step: 'summary', customer: {} };
    expect(applyInterpretation(state, result({ intent: 'question' }), catalog)).toBeNull();
  });
});

describe('messages de texto livre', () => {
  it('noted junta as partes', () => {
    expect(msg.noted(['3x Botijão P13', 'Pix'])).toBe('Anotado: 3x Botijão P13, Pix.');
  });

  it('textos fixos', () => {
    expect(msg.notUnderstood).toBe('Não entendi.');
    expect(msg.chooseAmbiguousProduct).toBe('Qual desses você quer?');
  });
});

describe('freeText', () => {
  const paying: OrderState = {
    step: 'choosePayment',
    customer: { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: null },
    address,
    product: p13,
    quantity: 1,
  };
  const paymentButtons = buttons(
    msg.choosePayment,
    [pix, money, credit].map(option => ({ id: `pay:${option.type}`, title: option.label })),
  );
  const tools = (value: Interpretation | null, overrides: Partial<FlowTools> = {}) =>
    createFakeTools({ interpret: async () => value, ...overrides });
  const called = (fake: FakeTools, name: string) =>
    fake.calls.filter(call => call.name === name).length;

  it('IA indisponível repete a pergunta e conta o "não entendi"', async () => {
    const fake = tools(null);
    const out = await freeText(paying, 'blá', fake);
    expect(out.replies).toEqual([text(msg.notUnderstood), paymentButtons]);
    expect(out.state).toMatchObject({ step: 'choosePayment', quantity: 1 });
    expect(out.misunderstood).toBe(true);
    expect(called(fake, 'registerMisunderstood')).toBe(1);
  });

  it('confiança baixa repete a pergunta', async () => {
    const out = await freeText(paying, 'blá', tools(result({ confidence: 0.5, quantity: 5 })));
    expect(out.replies).toEqual([text(msg.notUnderstood), paymentButtons]);
    expect(out.state?.quantity).toBe(1);
    expect(out.misunderstood).toBe(true);
  });

  it('3º "não entendi" seguido oferece o atendente antes da pergunta', async () => {
    const fake = tools(null, { registerMisunderstood: async () => 3 });
    const out = await freeText(paying, 'blá', fake);
    expect(out.replies).toEqual([offer(msg.stuck), paymentButtons]);
    expect(out.misunderstood).toBe(true);
  });

  it('pedido sem nada aplicável conta como "não entendi"', async () => {
    const out = await freeText(paying, 'quero', tools(result({ products: ['Lenha'] })));
    expect(out.replies).toEqual([text(msg.notUnderstood), paymentButtons]);
    expect(out.misunderstood).toBe(true);
  });

  it('"outro" não altera o pedido e conta como "não entendi"', async () => {
    const out = await freeText(paying, 'hmm 5', tools(result({ intent: 'other', quantity: 5 })));
    expect(out.state?.quantity).toBe(1);
    expect(out.replies).toEqual([text(msg.notUnderstood), paymentButtons]);
    expect(out.misunderstood).toBe(true);
  });

  it('dúvida vai para a base com o texto do cliente e não altera o pedido', async () => {
    const fake = tools(result({ intent: 'question', topic: 'general', quantity: 2 }));
    const spy = vi.spyOn(fake, 'answerQuestion');
    const out = await freeText(paying, 'tem entrega? quero 2', fake);
    expect(spy).toHaveBeenCalledWith('tem entrega? quero 2');
    expect(out.state?.quantity).toBe(1);
    expect(out.replies).toEqual([offer(msg.notKnown), paymentButtons]);
    expect(out.misunderstood).toBeUndefined();
    expect(called(fake, 'registerMisunderstood')).toBe(0);
  });

  it('"quanto tá o P13" no meio do pedido não troca o produto', async () => {
    const fake = tools(result({ intent: 'price', products: ['Botijão P13'] }), {
      basePrices: async () => [{ product: p13, minPrice: 110, varies: false }],
      quote: async () => ({ unitPrice: 999, total: 999 }),
    });
    const withP45: OrderState = { ...paying, product: p45, paymentOptions: [pix, money, credit] };
    const out = await freeText(withP45, 'quanto tá o P13?', fake);
    expect(out.state).toEqual(withP45);
    expect(out.replies).toEqual([
      text('Preços de hoje:\n- Botijão P13: R$ 110,00\nO total aparece no resumo do pedido.'),
      paymentButtons,
    ]);
  });

  it('pedido aplicado não marca "não entendi"', async () => {
    const fake = tools(result({ quantity: 2 }));
    const out = await freeText(paying, 'quero 2', fake);
    expect(out.state?.quantity).toBe(2);
    expect(out.misunderstood).toBeUndefined();
    expect(called(fake, 'registerMisunderstood')).toBe(0);
  });

  it('nas etapas de CPF os dígitos não chegam à IA', async () => {
    const fake = tools(null);
    const spy = vi.spyOn(fake, 'interpret');
    const asking: OrderState = { step: 'askCpf', customer: { name: 'Maria da Silva' } };
    await freeText(asking, 'meu cpf é 123.456 e quero 2 botijões P13', fake);
    const sent = spy.mock.calls[0]?.[0] ?? '';
    expect(sent).not.toMatch(/123|456/);
    expect(sent).toContain('2 botijões P13');
  });

  it('troca quantidade e pede novo endereço', async () => {
    const withAddresses: OrderState = {
      ...paying,
      addresses: [address, { ...address, number: '9' }],
    };
    const out = await freeText(
      withAddresses,
      'na verdade 3, em outro endereço',
      tools(result({ quantity: 3, newAddress: true })),
    );
    expect(out.replies[0]).toEqual(text('Anotado: 3x Botijão P13, entrega em outro endereço.'));
    expect(out.state?.step).toBe('chooseAddress');
    expect(out.state?.quantity).toBe(3);
  });

  it('produto que não vendemos junto com um que vendemos avisa antes do "Anotado"', async () => {
    const out = await freeText(
      paying,
      'quero P45 e carvão',
      tools(result({ products: ['Botijão P45'], unknownProduct: 'carvão' })),
    );
    expect(out.state?.product).toEqual(p45);
    expect(out.replies[0]).toEqual(text('Não temos carvão. Anotado: Botijão P45.'));
  });

  it('item "que não vendemos" que está no catálogo não gera aviso', async () => {
    const out = await freeText(
      paying,
      'quero P45',
      tools(result({ products: ['Botijão P45'], unknownProduct: 'Botijão P45' })),
    );
    expect(out.replies[0]).toEqual(text('Anotado: Botijão P45.'));
  });

  it('nas etapas de identificação repete a pergunta da etapa', async () => {
    const asking: OrderState = { step: 'askName', customer: {} };
    const out = await freeText(
      asking,
      'quero botijão no pix',
      tools(result({ products: ['Botijão P13'], payment: 'PIX' })),
    );
    expect(out.state).toMatchObject({ step: 'askName', product: p13, payment: pix });
    expect(out.replies).toHaveLength(2);
    expect(out.replies[1]).toEqual(text(msg.askName));
  });

  it('manda o contexto do catálogo', async () => {
    const fake = tools(result({ intent: 'other' }));
    const spy = vi.spyOn(fake, 'interpret');
    await freeText({ ...paying, step: 'summary' }, 'x', fake);
    expect(spy).toHaveBeenCalledWith('x', {
      products: ['Botijão P13', 'Botijão P45', 'Água mineral 20L'],
      payments: [
        { type: 'PIX', label: 'Pix' },
        { type: 'MONEY', label: 'Dinheiro' },
        { type: 'CARTAO_DE_CREDITO', label: 'Cartão de crédito' },
      ],
    });
    expect(fake.calls.map(call => call.name)).toContain('listProducts');
  });

  it('usa productOptions e paymentOptions do estado sem chamar o catálogo', async () => {
    const fake = tools(null);
    const spy = vi.spyOn(fake, 'interpret');
    await freeText({ ...paying, productOptions: [p45], paymentOptions: [pix] }, 'x', fake);
    expect(spy).toHaveBeenCalledWith('x', {
      products: ['Botijão P45'],
      payments: [{ type: 'PIX', label: 'Pix' }],
    });
    expect(fake.calls.map(call => call.name)).not.toContain('listProducts');
  });
});

describe('seedFromInterpretation', () => {
  it('pedido vira campos e "Anotado"', () => {
    const seed = seedFromInterpretation(
      result({ products: ['Botijão P13'], quantity: 2, payment: 'PIX' }),
      catalog,
    );
    expect(seed.fields).toEqual({ product: p13, quantity: 2, payment: pix });
    expect(seed.replies).toEqual([text(msg.noted(['2x Botijão P13', 'Pix']))]);
  });

  it('produto que não vendemos junto com um que vendemos avisa no "Anotado"', () => {
    const seed = seedFromInterpretation(
      result({ products: ['Botijão P13'], quantity: 2, unknownProduct: 'carvão!!' }),
      catalog,
    );
    expect(seed.fields).toEqual({ product: p13, quantity: 2 });
    expect(seed.replies).toEqual([text('Não temos carvão. Anotado: 2x Botijão P13.')]);
  });

  it('só "pedido" semeia', () => {
    const seed = seedFromInterpretation(result({ intent: 'other', quantity: 2 }), catalog);
    expect(seed).toEqual({ fields: {}, replies: [] });
  });
});

describe('keepOfferedProduct', () => {
  const only45 = () => createFakeTools({ listProducts: async () => [p45] });
  const base: OrderState = { step: 'askName', customer: { id: 1, tagId: null } };

  it('descarta o produto que o cliente não pode comprar', async () => {
    const out = await keepOfferedProduct({ ...base, product: p13, quantity: 2 }, only45());
    expect(out.product).toBeUndefined();
    expect(out.quantity).toBeUndefined();
    expect(out.quote).toBeUndefined();
  });

  it('candidatos que sobram viram o produto', async () => {
    const out = await keepOfferedProduct({ ...base, productCandidates: [p13, p45] }, only45());
    expect(out.product).toEqual(p45);
    expect(out.productCandidates).toBeUndefined();
  });

  it('mantém quando o produto está na lista', async () => {
    const state: OrderState = { ...base, product: p13, quantity: 2 };
    const out = await keepOfferedProduct(state, createFakeTools());
    expect(out).toEqual(state);
  });

  it('sem produto nem candidatos não chama listProducts', async () => {
    const fake = createFakeTools();
    const out = await keepOfferedProduct(base, fake);
    expect(out).toBe(base);
    expect(fake.calls).toEqual([]);
  });
});
