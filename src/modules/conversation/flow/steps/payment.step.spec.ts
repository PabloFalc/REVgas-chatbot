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
const options = [
  { type: 'PIX', label: 'Pix' },
  { type: 'MONEY', label: 'Dinheiro' },
  { type: 'CARTAO_DE_CREDITO', label: 'Cartão de crédito' },
];

const base: OrderState = {
  step: 'choosePayment',
  customer: { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: null },
  address,
  product: { id: 1, name: 'Botijão P13' },
  quantity: 2,
};

describe('choosePayment', () => {
  it('até 3 formas viram botões pay:<TYPE>', async () => {
    const result = await asks.choosePayment?.(base, createFakeTools());
    const reply = result?.replies[0];
    if (reply?.type !== 'buttons') throw new Error('expected buttons');
    expect(reply.buttons.map(b => b.id)).toEqual(['pay:PIX', 'pay:MONEY', 'pay:CARTAO_DE_CREDITO']);
    expect(result?.state?.paymentOptions).toEqual(options);
  });

  it('4 formas viram lista', async () => {
    const four = [...options, { type: 'BOLETO', label: 'Boleto' }];
    const result = await asks.choosePayment?.(
      base,
      createFakeTools({ listPaymentOptions: async () => four }),
    );
    expect(result?.replies[0].type).toBe('list');
  });

  it('pix cota e vai direto ao resumo', async () => {
    const tools = createFakeTools();
    const state: OrderState = { ...base, paymentOptions: options };
    const result = await handlers.choosePayment?.(state, pick('pay:PIX'), tools);
    expect(result?.state?.payment).toEqual(options[0]);
    expect(result?.state?.quote).toEqual({ unitPrice: 110, total: 220 });
    expect(result?.state?.step).toBe('summary');
  });

  it('dinheiro pergunta o troco e limpa cotação e troco anteriores', async () => {
    const state: OrderState = {
      ...base,
      paymentOptions: options,
      payment: options[0],
      quote: { unitPrice: 1, total: 1 },
      changeFor: 500,
    };
    const result = await handlers.choosePayment?.(state, pick('pay:MONEY'), createFakeTools());
    expect(result?.state?.quote).toEqual({ unitPrice: 110, total: 220 });
    expect(result?.state?.changeFor).toBeUndefined();
    expect(result?.state?.step).toBe('askNeedsChange');
  });

  it('forma desconhecida repete a pergunta', async () => {
    const state: OrderState = { ...base, paymentOptions: options };
    const result = await handlers.choosePayment?.(state, pick('pay:FIADO'), createFakeTools());
    expect(result?.state?.payment).toBeUndefined();
    expect(result?.state?.step).toBe('choosePayment');
    expect(result?.replies[0].type).toBe('buttons');
  });

  it('sem preço para a forma avisa e volta a escolher o pagamento', async () => {
    const tools = createFakeTools({ quote: async () => null });
    const state: OrderState = { ...base, paymentOptions: options };
    const result = await handlers.choosePayment?.(state, pick('pay:PIX'), tools);
    expect(result?.state?.step).toBe('choosePayment');
    expect(result?.state?.payment).toBeUndefined();
    expect(result?.replies[0]).toEqual(text(msg.noPriceForPayment));
    expect(result?.replies[1].type).toBe('buttons');
  });
});

describe('troco', () => {
  const money: OrderState = {
    ...base,
    step: 'askNeedsChange',
    payment: options[1],
    quote: { unitPrice: 110, total: 220 },
  };

  it('pergunta com o total e os botões change:no / change:yes', async () => {
    const result = await asks.askNeedsChange?.(money, createFakeTools());
    const reply = result?.replies[0];
    if (reply?.type !== 'buttons') throw new Error('expected buttons');
    expect(reply.body).toBe(msg.askNeedsChange(220));
    expect(reply.buttons.map(b => b.id)).toEqual(['change:no', 'change:yes']);
  });

  it('change:no grava troco nulo e vai ao resumo', async () => {
    const result = await handlers.askNeedsChange?.(money, pick('change:no'), createFakeTools());
    expect(result?.state?.changeFor).toBeNull();
    expect(result?.state?.step).toBe('summary');
  });

  it('change:yes pede o valor', async () => {
    const result = await handlers.askNeedsChange?.(money, pick('change:yes'), createFakeTools());
    expect(result?.state?.step).toBe('askChangeAmount');
    expect(result?.replies).toEqual([text(msg.askChangeAmount)]);
  });

  it('troco 200 com total 220 é recusado', async () => {
    const state: OrderState = { ...money, step: 'askChangeAmount' };
    const result = await handlers.askChangeAmount?.(state, say('200'), createFakeTools());
    expect(result).toEqual({ state, replies: [text(msg.invalidChange(220))] });
  });

  it('valor igual ao total é recusado e texto inválido também', async () => {
    const state: OrderState = { ...money, step: 'askChangeAmount' };
    const equal = await handlers.askChangeAmount?.(state, say('220'), createFakeTools());
    const junk = await handlers.askChangeAmount?.(state, say('abc'), createFakeTools());
    expect(equal?.replies).toEqual([text(msg.invalidChange(220))]);
    expect(junk?.replies).toEqual([text(msg.invalidChange(220))]);
  });

  it('troco válido em formato brasileiro segue ao resumo', async () => {
    const state: OrderState = { ...money, step: 'askChangeAmount' };
    const result = await handlers.askChangeAmount?.(state, say('R$ 250,00'), createFakeTools());
    expect(result?.state?.changeFor).toBe(250);
    expect(result?.state?.step).toBe('summary');
  });
});
