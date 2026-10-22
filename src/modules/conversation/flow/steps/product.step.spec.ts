import { describe, expect, it } from 'vitest';
import type { FlowInput, OrderState } from '../flow.types';
import { msg } from '../messages';
import { text } from '../replies';
import { createFakeTools, FAKE_PHONE } from '../testing/fake-tools';
import { asks, handlers } from './index';

const say = (body: string): FlowInput => ({
  phone: FAKE_PHONE,
  content: { type: 'text', text: body },
});
const pick = (id: string): FlowInput => ({
  phone: FAKE_PHONE,
  content: { type: 'choice', id, title: id },
});

const address = {
  street: 'Rua das Flores',
  number: '120',
  neighborhood: 'Centro',
  city: 'Teresina',
  state: 'PI',
};
const products = [
  { id: 1, name: 'Botijão P13' },
  { id: 2, name: 'Botijão P45' },
  { id: 3, name: 'Água mineral 20L' },
];

const base: OrderState = {
  step: 'chooseProduct',
  customer: { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: 5 },
  address,
};

function rowIds(result: Awaited<ReturnType<NonNullable<typeof asks.chooseProduct>>> | undefined) {
  const reply = result?.replies[0];
  if (reply?.type !== 'list') throw new Error('expected list');
  return reply.sections[0].rows.map(row => row.id);
}

describe('chooseProduct', () => {
  it('lista os produtos com o cliente de preço e guarda as opções', async () => {
    const tools = createFakeTools();
    const result = await asks.chooseProduct?.(base, tools);
    expect(tools.calls).toEqual([{ name: 'listProducts', args: [{ id: 1, tagId: 5 }] }]);
    expect(rowIds(result)).toEqual(['product:1', 'product:2', 'product:3']);
    expect(result?.state?.productOptions).toEqual(products);
  });

  it('produtos já comprados vêm primeiro, na ordem do histórico', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Produto ${i + 1}` }));
    const tools = createFakeTools({ listProducts: async () => many });
    const result = await asks.chooseProduct?.({ ...base, boughtProductIds: [7, 3] }, tools);
    expect(rowIds(result).slice(0, 4)).toEqual([
      'product:7',
      'product:3',
      'product:1',
      'product:2',
    ]);
  });

  it('mais de 10 produtos viram 9 mais a busca', async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, name: `Produto ${i + 1}` }));
    const tools = createFakeTools({ listProducts: async () => many });
    const result = await asks.chooseProduct?.(base, tools);
    const ids = rowIds(result);
    expect(ids).toHaveLength(10);
    expect(ids[8]).toBe('product:9');
    expect(ids[9]).toBe('product:search');
    expect(result?.state?.productOptions).toHaveLength(11);
  });

  it('lista vazia avisa indisponível e mantém o estado', async () => {
    const tools = createFakeTools({ listProducts: async () => [] });
    const result = await asks.chooseProduct?.(base, tools);
    expect(result).toEqual({ state: base, replies: [text(msg.unavailable)] });
  });

  it('escolher um produto guarda e vai para a quantidade, limpando quantidade e cotação', async () => {
    const state: OrderState = {
      ...base,
      productOptions: products,
      quantity: 3,
      quote: { unitPrice: 1, total: 3 },
    };
    const result = await handlers.chooseProduct?.(state, pick('product:2'), createFakeTools());
    expect(result?.state?.product).toEqual(products[1]);
    expect(result?.state?.quantity).toBeUndefined();
    expect(result?.state?.quote).toBeUndefined();
    expect(result?.state?.step).toBe('chooseQuantity');
    expect(result?.replies[0].type).toBe('buttons');
  });

  it('produto fora das opções repete a pergunta', async () => {
    const state: OrderState = { ...base, productOptions: products };
    const result = await handlers.chooseProduct?.(state, pick('product:99'), createFakeTools());
    expect(result?.state?.product).toBeUndefined();
    expect(result?.state?.step).toBe('chooseProduct');
    expect(result?.replies[0].type).toBe('list');
  });

  it('product:search pede o nome', async () => {
    const state: OrderState = { ...base, productOptions: products };
    const result = await handlers.chooseProduct?.(state, pick('product:search'), createFakeTools());
    expect(result?.state?.step).toBe('searchProduct');
    expect(result?.replies).toEqual([text(msg.askProductSearch)]);
  });
});

describe('searchProduct', () => {
  const state: OrderState = { ...base, step: 'searchProduct', productOptions: products };

  it('acha pelo nome sem acento e sem caixa', async () => {
    const result = await handlers.searchProduct?.(state, say('p13'), createFakeTools());
    expect(rowIds(result)).toEqual(['product:1']);
    expect(result?.state?.step).toBe('searchProduct');
    expect(result?.state?.productOptions).toEqual(products);
  });

  it('carrega os produtos de novo se faltarem', async () => {
    const tools = createFakeTools();
    const result = await handlers.searchProduct?.(
      { ...state, productOptions: undefined },
      say('agua'),
      tools,
    );
    expect(tools.calls.map(call => call.name)).toEqual(['listProducts']);
    expect(rowIds(result)).toEqual(['product:3']);
  });

  it('nada encontrado avisa e continua na busca', async () => {
    const result = await handlers.searchProduct?.(state, say('xyz'), createFakeTools());
    expect(result?.state?.step).toBe('searchProduct');
    expect(result?.replies).toEqual([text(msg.productNotFound)]);
  });

  it('escolher um resultado segue para a quantidade', async () => {
    const result = await handlers.searchProduct?.(state, pick('product:1'), createFakeTools());
    expect(result?.state?.product).toEqual(products[0]);
    expect(result?.state?.step).toBe('chooseQuantity');
  });
});

describe('quantidade', () => {
  const state: OrderState = {
    ...base,
    step: 'chooseQuantity',
    product: products[0],
    payment: { type: 'PIX', label: 'Pix' },
    quote: { unitPrice: 110, total: 110 },
    quantity: 1,
  };

  it('oferece 1, 2 e outra', async () => {
    const result = await asks.chooseQuantity?.(state, createFakeTools());
    const reply = result?.replies[0];
    if (reply?.type !== 'buttons') throw new Error('expected buttons');
    expect(reply.buttons.map(b => b.id)).toEqual(['qty:1', 'qty:2', 'qty:other']);
  });

  it('qty:2 define a quantidade, refaz a cotação e segue', async () => {
    const tools = createFakeTools();
    const result = await handlers.chooseQuantity?.(state, pick('qty:2'), tools);
    expect(result?.state?.quantity).toBe(2);
    expect(result?.state?.quote).toEqual({ unitPrice: 110, total: 220 });
    expect(result?.state?.step).toBe('summary');
  });

  it('qty:other pede o número', async () => {
    const result = await handlers.chooseQuantity?.(state, pick('qty:other'), createFakeTools());
    expect(result?.state?.step).toBe('askQuantity');
    expect(result?.replies).toEqual([text(msg.askQuantity)]);
  });

  it('número digitado é aceito', async () => {
    const result = await handlers.askQuantity?.(
      { ...state, step: 'askQuantity' },
      say(' 5 '),
      createFakeTools(),
    );
    expect(result?.state?.quantity).toBe(5);
  });

  it.each(['0', 'abc', '-2', '1,5'])('%s é recusado', async raw => {
    const askState: OrderState = { ...state, step: 'askQuantity' };
    const result = await handlers.askQuantity?.(askState, say(raw), createFakeTools());
    expect(result).toEqual({ state: askState, replies: [text(msg.invalidQuantity)] });
  });

  it('sem produto escolhido o fluxo volta ao produto', async () => {
    const { product: _product, ...rest } = state;
    const result = await handlers.chooseQuantity?.(rest, pick('qty:1'), createFakeTools());
    expect(result?.state?.step).toBe('chooseProduct');
  });
});

describe('pickProduct', () => {
  const candidates = [products[0], products[1]];
  const state: OrderState = {
    ...base,
    step: 'pickProduct',
    productCandidates: candidates,
    quantity: 3,
  };

  it('escolher um candidato mantém a quantidade', async () => {
    const result = await handlers.pickProduct?.(state, pick('product:2'), createFakeTools());
    expect(result?.state?.product).toEqual(products[1]);
    expect(result?.state?.quantity).toBe(3);
    expect(result?.state?.productCandidates).toBeUndefined();
  });

  it('escolha fora dos candidatos repete a lista filtrada', async () => {
    const result = await handlers.pickProduct?.(state, pick('product:3'), createFakeTools());
    expect(result?.state?.step).toBe('pickProduct');
    expect(rowIds(result)).toEqual(['product:1', 'product:2']);
  });
});
