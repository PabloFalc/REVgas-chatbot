import { SaleRejectedError } from 'src/modules/order/contracts/order.types';
import { describe, expect, it } from 'vitest';
import { type FlowInput, type OrderState, ToolError } from '../flow.types';
import { msg } from '../messages';
import { text } from '../replies';
import { createFakeTools, FAKE_NOW, FAKE_PHONE } from '../testing/fake-tools';
import { asks, handlers } from './index';
import { cancelAfterFailedSale } from './summary.step';

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

const pix = { type: 'PIX', label: 'Pix' };
const money = { type: 'MONEY', label: 'Dinheiro' };

const base: OrderState = {
  step: 'summary',
  customer: { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: null },
  addresses: [address],
  address,
  product: { id: 1, name: 'Botijão P13' },
  quantity: 1,
  payment: pix,
  quote: { unitPrice: 110, total: 110 },
};

const order = {
  customerId: 1,
  address,
  productId: 1,
  productName: 'Botijão P13',
  quantity: 1,
  unitPrice: 110,
  paymentType: 'PIX',
  total: 110,
};

describe('summary', () => {
  it('mostra o resumo com confirmar e corrigir', async () => {
    const result = await asks.summary?.(base, createFakeTools());
    const reply = result?.replies[0];
    if (reply?.type !== 'buttons') throw new Error('expected buttons');
    expect(reply.body).toBe(msg.summary(base));
    expect(reply.buttons.map(b => b.id)).toEqual(['summary:confirm', 'summary:fix']);
  });

  it('resumo inclui o troco quando há', () => {
    const body = msg.summary({ ...base, payment: money, changeFor: 250 });
    expect(body).toContain('Dinheiro (troco para R$ 250,00)');
  });

  it('confirmar salva o checkpoint antes de criar a venda e encerra', async () => {
    const tools = createFakeTools();
    const result = await handlers.summary?.(base, pick('summary:confirm'), tools);
    expect(result).toEqual({ state: null, replies: [text(msg.saleCreated(4521))], saleId: 4521 });
    expect(tools.calls.map(c => c.name)).toEqual(['checkpoint', 'createSale']);
    expect(tools.calls[0].args[0]).toMatchObject({
      step: 'creatingSale',
      saleAttemptAt: FAKE_NOW.toISOString(),
    });
    expect(tools.calls[1].args[0]).toEqual(order);
  });

  it('dinheiro com troco vira observação', async () => {
    const tools = createFakeTools();
    const state = { ...base, payment: money, changeFor: 250 };
    await handlers.summary?.(state, pick('summary:confirm'), tools);
    expect(tools.calls[1].args[0]).toMatchObject({
      paymentType: 'MONEY',
      observation: 'Troco para R$ 250,00',
    });
  });

  it('sem troco não há observação', async () => {
    const tools = createFakeTools();
    await handlers.summary?.(
      { ...base, payment: money, changeFor: null },
      pick('summary:confirm'),
      tools,
    );
    expect(tools.calls[1].args[0]).not.toHaveProperty('observation');
  });

  it('falha ao criar a venda vai para saleFailed com tentar de novo', async () => {
    const tools = createFakeTools({
      createSale: async () => {
        throw new ToolError(new Error('fora'));
      },
    });
    const result = await handlers.summary?.(base, pick('summary:confirm'), tools);
    expect(result?.state).toMatchObject({
      step: 'saleFailed',
      saleAttemptAt: FAKE_NOW.toISOString(),
    });
    const reply = result?.replies[0];
    if (reply?.type !== 'buttons') throw new Error('expected buttons');
    expect(reply.body).toBe(msg.saleFailed);
    expect(reply.buttons.map(b => b.id)).toEqual(['retry:sale']);
  });

  it('venda rejeitada pelo ERP encerra o pedido sem tentar de novo', async () => {
    const tools = createFakeTools({
      createSale: async () => {
        throw new ToolError(new SaleRejectedError('invalid'));
      },
    });
    const result = await handlers.summary?.(base, pick('summary:confirm'), tools);
    expect(result).toEqual({ state: null, replies: [text(msg.saleRejected(tools.storePhone))] });
    expect(result?.replies.some(reply => reply.type === 'buttons')).toBe(false);
  });

  it('erro que não é de ferramenta não é escondido', async () => {
    const tools = createFakeTools({
      createSale: async () => {
        throw new TypeError('bug');
      },
    });
    await expect(handlers.summary?.(base, pick('summary:confirm'), tools)).rejects.toThrow('bug');
  });

  it('corrigir abre as opções de correção', async () => {
    const result = await handlers.summary?.(base, pick('summary:fix'), createFakeTools());
    const reply = result?.replies[0];
    if (reply?.type !== 'buttons') throw new Error('expected buttons');
    expect(result?.state?.step).toBe('chooseCorrection');
    expect(reply.buttons.map(b => b.id)).toEqual(['fix:product', 'fix:address', 'fix:payment']);
  });

  it('entrada inesperada repete o resumo sem criar venda', async () => {
    const tools = createFakeTools();
    const result = await handlers.summary?.(
      base,
      { phone: FAKE_PHONE, content: { type: 'text', text: 'sim' } },
      tools,
    );
    expect(result?.state?.step).toBe('summary');
    expect(tools.calls).toEqual([]);
  });
});

describe('chooseCorrection', () => {
  const state: OrderState = { ...base, step: 'chooseCorrection', changeFor: null };

  it('produto limpa produto, quantidade e cotação e pergunta o produto', async () => {
    const result = await handlers.chooseCorrection?.(state, pick('fix:product'), createFakeTools());
    expect(result?.state?.step).toBe('chooseProduct');
    expect(result?.state?.product).toBeUndefined();
    expect(result?.state?.quantity).toBeUndefined();
    expect(result?.state?.quote).toBeUndefined();
    expect(result?.state?.payment).toEqual(pix);
  });

  it('endereço limpa o endereço e pergunta de novo', async () => {
    const result = await handlers.chooseCorrection?.(state, pick('fix:address'), createFakeTools());
    expect(result?.state?.step).toBe('chooseAddress');
    expect(result?.state?.address).toBeUndefined();
    expect(result?.state?.product).toEqual(state.product);
  });

  it('pagamento limpa forma, cotação e troco e pergunta o pagamento', async () => {
    const result = await handlers.chooseCorrection?.(
      { ...state, payment: money, changeFor: 250 },
      pick('fix:payment'),
      createFakeTools(),
    );
    expect(result?.state?.step).toBe('choosePayment');
    expect(result?.state?.payment).toBeUndefined();
    expect(result?.state?.quote).toBeUndefined();
    expect(result?.state?.changeFor).toBeUndefined();
  });

  it('entrada inesperada repete as opções', async () => {
    const result = await handlers.chooseCorrection?.(state, pick('x:y'), createFakeTools());
    expect(result?.state?.step).toBe('chooseCorrection');
  });

  it('total 220, troco 250, produto corrigido para quantidade 2 (total 440) volta a perguntar o troco', async () => {
    const tools = createFakeTools({
      quote: async (_customer, _productId, _type, quantity) => ({
        unitPrice: 220,
        total: 220 * quantity,
      }),
    });
    const start: OrderState = {
      ...state,
      payment: money,
      quantity: 1,
      quote: { unitPrice: 220, total: 220 },
      changeFor: 250,
      productOptions: [{ id: 1, name: 'Botijão P13' }],
    };
    const cleared = await handlers.chooseCorrection?.(start, pick('fix:product'), tools);
    expect(cleared?.state?.step).toBe('chooseProduct');
    const afterProduct = await handlers.chooseProduct?.(
      cleared?.state as OrderState,
      pick('product:1'),
      tools,
    );
    expect(afterProduct?.state?.step).toBe('chooseQuantity');
    const afterQuantity = await handlers.chooseQuantity?.(
      afterProduct?.state as OrderState,
      pick('qty:2'),
      tools,
    );
    expect(afterQuantity?.state?.quote?.total).toBe(440);
    expect(afterQuantity?.state?.step).toBe('askNeedsChange');
  });
});

describe('creatingSale', () => {
  const state: OrderState = {
    ...base,
    step: 'creatingSale',
    saleAttemptAt: '2026-10-21T15:00:00Z',
  };

  it('tentativa com 60 s ou mais vira saleFailed com tentar de novo', async () => {
    const stale = { ...state, saleAttemptAt: new Date(FAKE_NOW.getTime() - 60_000).toISOString() };
    const tools = createFakeTools();
    const result = await handlers.creatingSale?.(stale, pick('x:y'), tools);
    expect(result?.state?.step).toBe('saleFailed');
    const reply = result?.replies[0];
    if (reply?.type !== 'buttons') throw new Error('expected buttons');
    expect(reply.buttons.map(b => b.id)).toEqual(['retry:sale']);
    expect(tools.calls).toEqual([]);
  });

  it('tentativa com menos de 60 s continua em andamento', async () => {
    const fresh = { ...state, saleAttemptAt: new Date(FAKE_NOW.getTime() - 59_000).toISOString() };
    const result = await handlers.creatingSale?.(fresh, pick('x:y'), createFakeTools());
    expect(result).toEqual({ state: fresh, replies: [text(msg.saleInProgress)] });
  });

  it('qualquer entrada responde que está em andamento e não cria venda', async () => {
    const tools = createFakeTools();
    const confirm = await handlers.creatingSale?.(state, pick('summary:confirm'), tools);
    const retry = await handlers.creatingSale?.(state, pick('retry:sale'), tools);
    expect(confirm).toEqual({ state, replies: [text(msg.saleInProgress)] });
    expect(retry).toEqual({ state, replies: [text(msg.saleInProgress)] });
    expect(tools.calls).toEqual([]);
  });
});

describe('saleFailed', () => {
  const state: OrderState = {
    ...base,
    step: 'saleFailed',
    saleAttemptAt: '2026-10-21T15:00:00.000Z',
  };

  it('tentar de novo acha a venda recente e encerra sem criar outra', async () => {
    const tools = createFakeTools({ findRecentSale: async () => 777 });
    const result = await handlers.saleFailed?.(state, pick('retry:sale'), tools);
    expect(result).toEqual({ state: null, replies: [text(msg.saleCreated(777))], saleId: 777 });
    expect(tools.calls.map(c => c.name)).not.toContain('createSale');
  });

  it('consulta a venda desde o momento da tentativa', async () => {
    const seen: unknown[] = [];
    const tools = createFakeTools({
      findRecentSale: async (order, since) => {
        seen.push(order, since);
        return null;
      },
    });
    await handlers.saleFailed?.(state, pick('retry:sale'), tools);
    expect(seen[0]).toEqual(order);
    expect(seen[1]).toEqual(new Date('2026-10-21T15:00:00.000Z'));
  });

  it('sem venda recente, salva novo checkpoint e cria a venda', async () => {
    const tools = createFakeTools();
    const result = await handlers.saleFailed?.(state, pick('retry:sale'), tools);
    expect(result).toEqual({ state: null, replies: [text(msg.saleCreated(4521))], saleId: 4521 });
    expect(tools.calls.map(c => c.name)).toEqual(['findRecentSale', 'checkpoint', 'createSale']);
    expect(tools.calls[1].args[0]).toMatchObject({
      step: 'creatingSale',
      saleAttemptAt: state.saleAttemptAt,
    });
  });

  it('outra entrada repete o botão de tentar de novo sem criar venda', async () => {
    const tools = createFakeTools();
    const result = await handlers.saleFailed?.(
      state,
      { phone: FAKE_PHONE, content: { type: 'text', text: 'oi' } },
      tools,
    );
    expect(result?.state?.step).toBe('saleFailed');
    expect(tools.calls).toEqual([]);
  });

  it('cancelar depois da falha acha a venda criada e avisa o número em vez de cancelar', async () => {
    const seen: unknown[] = [];
    const tools = createFakeTools({
      findRecentSale: async (order, since) => {
        seen.push(order, since);
        return 888;
      },
    });
    const result = await cancelAfterFailedSale(state, tools);
    expect(result).toEqual({ state: null, replies: [text(msg.saleCreated(888))], saleId: 888 });
    expect(seen[0]).toEqual(order);
    expect(seen[1]).toEqual(new Date('2026-10-21T15:00:00.000Z'));
  });

  it('cancelar depois da falha sem venda encontrada cancela normalmente', async () => {
    const result = await cancelAfterFailedSale(state, createFakeTools());
    expect(result).toEqual({ state: null, replies: [text(msg.cancelled)] });
  });
});
