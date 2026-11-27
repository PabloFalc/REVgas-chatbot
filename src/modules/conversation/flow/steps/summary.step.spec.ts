import type { Interpretation } from 'src/modules/assistant/contracts/assistant.types';
import { SaleRejectedError } from 'src/modules/order/contracts/order.types';
import { describe, expect, it, vi } from 'vitest';
import { runFlow } from '../flow';
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

const CONFIRM = 'summary:confirm:1';

const pix = { type: 'PIX', label: 'Pix' };
const money = { type: 'MONEY', label: 'Dinheiro' };

const base: OrderState = {
  step: 'summary',
  revision: 1,
  customer: { id: 1, name: 'Maria da Silva', cpfPrefix: '123', tagId: null },
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
    expect(reply.buttons.map(b => b.id)).toEqual(['summary:confirm:1', 'summary:fix']);
  });

  it('primeiro resumo de um estado sem revisão começa na revisão 1', async () => {
    const { revision: _revision, ...legacy } = base;
    const result = await asks.summary?.(legacy, createFakeTools());
    const reply = result?.replies[0];
    if (reply?.type !== 'buttons') throw new Error('expected buttons');
    expect(result?.state?.revision).toBe(1);
    expect(reply.buttons.map(b => b.id)).toEqual(['summary:confirm:1', 'summary:fix']);
  });

  it('reexibir o resumo sem mudança mantém a revisão', async () => {
    const result = await asks.summary?.({ ...base, revision: 4 }, createFakeTools());
    const reply = result?.replies[0];
    if (reply?.type !== 'buttons') throw new Error('expected buttons');
    expect(result?.state?.revision).toBe(4);
    expect(reply.buttons.map(b => b.id)).toEqual(['summary:confirm:4', 'summary:fix']);
  });

  it('ignora confirmação com revisão anterior', async () => {
    const tools = createFakeTools();
    const shown = await asks.summary?.(base, tools);
    const oldButton = shown?.replies[0].type === 'buttons' ? shown.replies[0].buttons[0].id : '';
    expect(oldButton).toBe('summary:confirm:1');

    const fixing = await handlers.summary?.(shown?.state as OrderState, pick('summary:fix'), tools);
    const choosing = await handlers.chooseCorrection?.(
      fixing?.state as OrderState,
      pick('fix:address'),
      tools,
    );
    const next = await handlers.chooseAddress?.(
      choosing?.state as OrderState,
      pick('address:0'),
      tools,
    );
    expect(next?.state?.step).toBe('summary');
    expect(next?.state?.revision).toBe(2);

    tools.calls.length = 0;
    const result = await handlers.summary?.(next?.state as OrderState, pick(oldButton), tools);
    expect(result?.state).toEqual(next?.state);
    expect(result?.replies[0]).toEqual(text(msg.staleConfirmation));
    const reply = result?.replies[1];
    if (reply?.type !== 'buttons') throw new Error('expected buttons');
    expect(reply.buttons.map(b => b.id)).toEqual(['summary:confirm:2', 'summary:fix']);
  });

  it('não cria venda quando recebe confirmação antiga', async () => {
    const stale = [
      'summary:confirm',
      'summary:confirm:',
      'summary:confirm:0',
      'summary:confirm:2',
      'summary:confirm:01',
      'summary:confirm:-1',
      'summary:confirm:1.5',
      'summary:confirm:1:2',
      'summary:confirm:abc',
      'summary:confirm:99999999999999999999',
    ];
    for (const id of stale) {
      const tools = createFakeTools();
      const result = await handlers.summary?.(base, pick(id), tools);
      expect(
        tools.calls.map(call => call.name),
        id,
      ).toEqual(['track']);
      expect(tools.calls[0].args[0], id).toEqual({
        name: 'summary_confirmation_rejected',
        reason: 'stale_revision',
      });
      expect(result?.saleId, id).toBeUndefined();
      expect(result?.state, id).toEqual(base);
      expect(result?.replies[0], id).toEqual(text(msg.staleConfirmation));
    }
  });

  it('estado antigo sem revisão não aceita botão e reexibe com a revisão 1', async () => {
    const { revision: _revision, ...legacy } = base;
    for (const id of ['summary:confirm', 'summary:confirm:1']) {
      const tools = createFakeTools();
      const result = await handlers.summary?.(legacy, pick(id), tools);
      expect(
        tools.calls.map(call => call.name),
        id,
      ).toEqual(['track']);
      expect(result?.state?.revision, id).toBe(1);
      expect(result?.replies[0], id).toEqual(text(msg.staleConfirmation));
    }
  });

  it('corrigir incrementa a revisão e confirmar com o botão novo vende', async () => {
    const tools = createFakeTools();
    const fixing = await handlers.summary?.(base, pick('summary:fix'), tools);
    const choosing = await handlers.chooseCorrection?.(
      fixing?.state as OrderState,
      pick('fix:address'),
      tools,
    );
    const next = await handlers.chooseAddress?.(
      choosing?.state as OrderState,
      pick('address:0'),
      tools,
    );
    tools.calls.length = 0;
    const done = await handlers.summary?.(
      next?.state as OrderState,
      pick('summary:confirm:2'),
      tools,
    );
    expect(done?.saleId).toBe(4521);
    expect(tools.calls.map(call => call.name)).toEqual(['checkpoint', 'createSale']);
  });

  describe('texto livre depois do resumo', () => {
    const typed = (body: string): FlowInput => ({
      phone: FAKE_PHONE,
      content: { type: 'text', text: body },
    });
    const reading = (partial: Partial<Interpretation>) =>
      createFakeTools({
        interpret: async () => ({ intent: 'order', confidence: 0.9, ...partial }),
      });
    const tracked = (tools: ReturnType<typeof createFakeTools>) =>
      tools.calls.filter(call => call.name === 'track').map(call => call.args[0]);

    it('reexibe o resumo quando o texto livre altera um campo do pedido', async () => {
      const tools = reading({ quantity: 2 });
      const result = await handlers.summary?.(base, typed('quero 2'), tools);
      expect(result?.state?.step).toBe('summary');
      expect(result?.state?.quantity).toBe(2);
      expect(result?.state?.revision).toBe(2);
      expect(result?.replies[0]).toEqual(text(msg.summaryUpdated));
      expect(result?.replies).toHaveLength(2);
      const reply = result?.replies[1];
      if (reply?.type !== 'buttons') throw new Error('expected buttons');
      expect(reply.buttons.map(b => b.id)).toEqual(['summary:confirm:2', 'summary:fix']);
      expect(tracked(tools)).toEqual([{ name: 'summary_changed', fields: ['quantity'] }]);
    });

    it('incrementa a revisão uma vez só quando muda mais de um campo', async () => {
      const tools = reading({ quantity: 3, payment: 'MONEY' });
      const result = await handlers.summary?.(base, typed('3 no dinheiro'), tools);
      expect(result?.state?.revision).toBe(2);
      expect(tracked(tools)).toEqual([
        { name: 'summary_changed', fields: ['quantity', 'payment'] },
      ]);
    });

    it('botão da revisão anterior não vende depois da mudança por texto', async () => {
      const tools = reading({ quantity: 2 });
      const changed = await handlers.summary?.(base, typed('quero 2'), tools);
      tools.calls.length = 0;
      const result = await handlers.summary?.(changed?.state as OrderState, pick(CONFIRM), tools);
      expect(tools.calls.map(call => call.name)).not.toContain('createSale');
      expect(result?.saleId).toBeUndefined();
      expect(result?.replies[0]).toEqual(text(msg.staleConfirmation));
    });

    it('texto que repete o mesmo valor não incrementa a revisão', async () => {
      for (const partial of [{ quantity: 1 }, { payment: 'PIX' }]) {
        const tools = reading(partial);
        const result = await handlers.summary?.(base, typed('igual'), tools);
        expect(result?.state?.revision).toBe(1);
        expect(result?.replies[0]).not.toEqual(text(msg.summaryUpdated));
        expect(tracked(tools)).toEqual([]);
      }
    });

    it('texto irrelevante não incrementa a revisão nem altera o pedido', async () => {
      const tools = reading({ intent: 'other' });
      const result = await handlers.summary?.(base, typed('bom dia, tudo bem?'), tools);
      expect(result?.state).toEqual(base);
      expect(tracked(tools)).toEqual([]);
    });

    it('mudança que leva a outra pergunta sobe a revisão sem o aviso de resumo', async () => {
      const tools = reading({ products: ['Botijão P45'] });
      const result = await handlers.summary?.(base, typed('quero o P45'), tools);
      expect(result?.state?.step).toBe('chooseQuantity');
      expect(result?.state?.revision).toBe(2);
      expect(result?.replies).not.toContainEqual(text(msg.summaryUpdated));
    });
  });

  it('resumo inclui o troco quando há', () => {
    const body = msg.summary({ ...base, payment: money, changeFor: 250 });
    expect(body).toContain('Dinheiro (troco para R$ 250,00)');
  });

  it('em demonstração a confirmação diz que nenhum gás será entregue', async () => {
    const tools = createFakeTools({ demo: true });
    const result = await handlers.summary?.(base, pick(CONFIRM), tools);
    expect(result).toEqual({
      state: null,
      replies: [
        text(
          'Pedido de demonstração nº 4521 registrado. Total: R$ 110,00. Nenhum gás será entregue.',
        ),
      ],
      saleId: 4521,
    });
  });

  it('confirmar salva o checkpoint antes de criar a venda e encerra', async () => {
    const tools = createFakeTools();
    const result = await handlers.summary?.(base, pick(CONFIRM), tools);
    expect(result).toEqual({
      state: null,
      replies: [text(msg.saleCreated(4521, 110))],
      saleId: 4521,
    });
    expect(msg.saleCreated(4521, 110)).toBe(
      'Pedido nº 4521 registrado na revenda. Total: R$ 110,00. Se precisar de algo, é só chamar.',
    );
    expect(tools.calls.map(c => c.name)).toEqual(['checkpoint', 'createSale']);
    expect(tools.calls[0].args[0]).toMatchObject({
      step: 'creatingSale',
      saleAttemptAt: FAKE_NOW.toISOString(),
    });
    expect(tools.calls[1].args[0]).toEqual(order);
  });

  it('não usa IA para ação de botão de confirmação', async () => {
    const interpret = vi.fn(async (): Promise<Interpretation | null> => {
      throw new Error('provedor indisponível');
    });
    const tools = createFakeTools({ interpret });
    const result = await handlers.summary?.(base, pick(CONFIRM), tools);
    expect(result?.saleId).toBe(4521);
    expect(tools.calls.map(call => call.name)).toEqual(['checkpoint', 'createSale']);
    expect(interpret).not.toHaveBeenCalled();
  });

  it('dinheiro com troco vira observação', async () => {
    const tools = createFakeTools();
    const state = { ...base, payment: money, changeFor: 250 };
    await handlers.summary?.(state, pick(CONFIRM), tools);
    expect(tools.calls[1].args[0]).toMatchObject({
      paymentType: 'MONEY',
      observation: 'Troco para R$ 250,00',
    });
  });

  it('sem troco não há observação', async () => {
    const tools = createFakeTools();
    await handlers.summary?.({ ...base, payment: money, changeFor: null }, pick(CONFIRM), tools);
    expect(tools.calls[1].args[0]).not.toHaveProperty('observation');
  });

  it('falha ao criar a venda vai para saleFailed com tentar de novo', async () => {
    const tools = createFakeTools({
      createSale: async () => {
        throw new ToolError(new Error('fora'));
      },
    });
    const result = await handlers.summary?.(base, pick(CONFIRM), tools);
    expect(result?.state).toMatchObject({
      step: 'saleFailed',
      saleAttemptAt: FAKE_NOW.toISOString(),
    });
    const reply = result?.replies[0];
    if (reply?.type !== 'buttons') throw new Error('expected buttons');
    expect(reply.body).toBe(msg.saleFailed);
    expect(reply.buttons.map(b => b.id)).toEqual(['retry:sale', 'handoff:request']);
  });

  it('venda rejeitada pelo ERP encerra o pedido sem tentar de novo', async () => {
    const tools = createFakeTools({
      createSale: async () => {
        throw new ToolError(new SaleRejectedError('invalid'));
      },
    });
    const result = await handlers.summary?.(base, pick(CONFIRM), tools);
    expect(result).toEqual({ state: null, replies: [text(msg.saleRejected(tools.storePhone))] });
    expect(result?.replies.some(reply => reply.type === 'buttons')).toBe(false);
  });

  it('erro que não é de ferramenta não é escondido', async () => {
    const tools = createFakeTools({
      createSale: async () => {
        throw new TypeError('bug');
      },
    });
    await expect(handlers.summary?.(base, pick(CONFIRM), tools)).rejects.toThrow('bug');
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
    expect(tools.calls.map(call => call.name)).not.toContain('createSale');
  });
});

describe('mensagens de resultado', () => {
  it('mensagens distinguem registro, instabilidade e resultado incerto', () => {
    expect(msg.saleCreated(4521, 110)).not.toContain('separando');
    expect(msg.saleStoreUnavailable).toBe(
      'Estou com instabilidade para registrar pedidos agora. Seu pedido não foi enviado. Tente confirmar de novo em alguns minutos.',
    );
    expect(msg.saleUncertain).toBe(
      'Não consegui confirmar se seu pedido foi registrado. Para não duplicar, não vou enviar de novo. Chamei um atendente para conferir com a revenda.',
    );
    expect(msg.saleUncertain).not.toContain('Nada foi cobrado');
    expect(msg.priceChanged).toBe(
      'O preço mudou desde o resumo. Confira os valores atualizados antes de confirmar.',
    );
    expect(msg.cancelNeedsAgent).toBe(
      'Não tenho pedido em andamento aqui. Se você quer cancelar um pedido já feito, um atendente resolve isso.',
    );
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
    expect(result?.state?.revision).toBe(1);
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
    expect(reply.buttons.map(b => b.id)).toEqual(['retry:sale', 'handoff:request']);
    expect(tools.calls).toEqual([]);
  });

  it('tentativa com menos de 60 s continua em andamento', async () => {
    const fresh = { ...state, saleAttemptAt: new Date(FAKE_NOW.getTime() - 59_000).toISOString() };
    const result = await handlers.creatingSale?.(fresh, pick('x:y'), createFakeTools());
    expect(result).toEqual({ state: fresh, replies: [text(msg.saleInProgress)] });
  });

  it('qualquer entrada responde que está em andamento e não cria venda', async () => {
    const tools = createFakeTools();
    const confirm = await handlers.creatingSale?.(state, pick(CONFIRM), tools);
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
    expect(result).toEqual({
      state: null,
      replies: [text(msg.saleCreated(777, 110))],
      saleId: 777,
    });
    expect(tools.calls.map(c => c.name)).not.toContain('createSale');
  });

  it('erro ao consultar venda recente mantém saleFailed e não cria venda', async () => {
    const findRecentSale = vi.fn(async () => {
      throw new Error('fora');
    });
    const createSale = vi.fn(async () => 4521);
    const tools = createFakeTools({
      findRecentSale,
      createSale,
    });
    const result = await runFlow(state, pick('retry:sale'), tools);
    expect(result?.state).toEqual(state);
    expect(findRecentSale).toHaveBeenCalledOnce();
    expect(createSale).not.toHaveBeenCalled();
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
    expect(result).toEqual({
      state: null,
      replies: [text(msg.saleCreated(4521, 110))],
      saleId: 4521,
    });
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
    expect(result).toEqual({
      state: null,
      replies: [text(msg.saleCreated(888, 110))],
      saleId: 888,
    });
    expect(seen[0]).toEqual(order);
    expect(seen[1]).toEqual(new Date('2026-10-21T15:00:00.000Z'));
    expect(tools.calls).not.toContainEqual({
      name: 'track',
      args: [{ name: 'order_cancelled' }],
    });
  });

  it('cancelar depois da falha sem venda encontrada cancela normalmente', async () => {
    const tools = createFakeTools();
    const result = await cancelAfterFailedSale(state, tools);
    expect(result).toEqual({ state: null, replies: [text(msg.cancelled)] });
    expect(tools.calls).toContainEqual({ name: 'track', args: [{ name: 'order_cancelled' }] });
  });
});
