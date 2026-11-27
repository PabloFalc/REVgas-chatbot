import { describe, expect, it } from 'vitest';
import type { FlowInput, FlowTools, OrderState, Step } from '../flow.types';
import { offer } from '../handoff';
import { msg } from '../messages';
import { buttons, text } from '../replies';
import { createFakeTools, FAKE_PHONE } from '../testing/fake-tools';
import { handlers } from './index';

const say = (body: string): FlowInput => ({
  phone: FAKE_PHONE,
  content: { type: 'text', text: body },
});

const address = {
  street: 'Rua das Flores',
  number: '120',
  neighborhood: 'Centro',
  city: 'Teresina',
  state: 'PI',
};
const p13 = { id: 1, name: 'Botijão P13' };
const pix = { type: 'PIX', label: 'Pix' };
const money = { type: 'MONEY', label: 'Dinheiro' };

const full: OrderState = {
  step: 'summary',
  customer: { id: 1, name: 'Maria da Silva', tagId: null },
  addresses: [address],
  address,
  product: p13,
  productOptions: [p13],
  productCandidates: [p13, { id: 2, name: 'Botijão P45' }],
  draftAddress: { ...address, number: undefined },
  quantity: 1,
  payment: pix,
  paymentOptions: [pix, money],
  quote: { unitPrice: 110, total: 110 },
};

function tools() {
  const fake = createFakeTools({
    interpret: async () => {
      fake.calls.push({ name: 'interpret', args: [] });
      return { intent: 'order', quantity: 3, confidence: 0.9 };
    },
  });
  return fake;
}

function interpretCalls(fake: ReturnType<typeof createFakeTools>) {
  return fake.calls.filter(call => call.name === 'interpret');
}

async function run(step: Step, input: string, state: Partial<OrderState> = {}) {
  const fake = tools();
  const handler = handlers[step];
  const out = await handler?.({ ...full, ...state, step }, say(input), fake);
  return { fake, out };
}

describe('texto guiado da etapa quando a IA não entende', () => {
  const withAi = (overrides: Partial<FlowTools> = {}) =>
    createFakeTools({ interpret: async () => null, ...overrides });

  it.each([
    ['askCpf', 'não tenho CPF', msg.invalidCpf],
    ['confirmCpf', 'não lembro', msg.askFullCpf],
    ['askQuantity', 'uns dois', msg.invalidQuantity],
    ['askChangeAmount', 'não sei ainda', msg.invalidChange(110)],
  ] as [Step, string, string][])('%s: "%s" recebe o texto da etapa', async (step, raw, guided) => {
    const tools = withAi();
    const state = { ...full, step };
    const out = await handlers[step]?.(state, say(raw), tools);
    expect(out).toEqual({ state, replies: [text(guided)], misunderstood: true });
    expect(tools.calls.map(call => call.name)).toContain('registerMisunderstood');
  });

  it('pedido sem nada aplicável também recebe o texto da etapa', async () => {
    const tools = withAi({
      interpret: async () => ({ intent: 'order', products: ['Lenha'], confidence: 0.9 }),
    });
    const out = await handlers.askQuantity?.({ ...full, step: 'askQuantity' }, say('lenha'), tools);
    expect(out?.replies).toEqual([text(msg.invalidQuantity)]);
    expect(out?.misunderstood).toBe(true);
  });

  it('3ª vez seguida oferece o atendente e repete a pergunta', async () => {
    const tools = withAi({ registerMisunderstood: async () => 3 });
    const state = { ...full, step: 'askQuantity' as Step };
    const out = await handlers.askQuantity?.(state, say('uns dois'), tools);
    expect(out?.replies).toEqual([offer(msg.stuck), text(msg.askQuantity)]);
    expect(out?.misunderstood).toBe(true);
  });

  it('dúvida continua roteada', async () => {
    const tools = withAi({
      interpret: async () => ({ intent: 'off_topic', confidence: 0.9 }),
    });
    const state = { ...full, step: 'askQuantity' as Step };
    const out = await handlers.askQuantity?.(state, say('receita de bolo'), tools);
    expect(out?.replies).toEqual([text(msg.offTopicRefusal), text(msg.askQuantity)]);
    expect(out?.misunderstood).toBeUndefined();
  });
});

describe('fallback de texto livre nas etapas', () => {
  it.each([
    'chooseAddress',
    'confirmAddress',
    'chooseProduct',
    'pickProduct',
    'chooseQuantity',
    'choosePayment',
    'askNeedsChange',
    'summary',
    'chooseCorrection',
  ] as Step[])('%s chama a IA e aplica a quantidade', async step => {
    const { fake, out } = await run(step, 'quero 3 botijões');
    expect(interpretCalls(fake)).toHaveLength(1);
    expect(out?.state?.quantity).toBe(3);
  });

  it.each(['summary', 'chooseCorrection'] as Step[])('%s com IA não cria a venda', async step => {
    const { fake, out } = await run(step, 'quero 3 botijões');
    expect(fake.calls.some(call => call.name === 'createSale')).toBe(false);
    expect(out?.state?.step).toBe('summary');
  });

  it('chooseQuantity aceita número digitado sem IA', async () => {
    const { fake, out } = await run('chooseQuantity', '2', { quantity: undefined });
    expect(out?.state?.quantity).toBe(2);
    expect(interpretCalls(fake)).toHaveLength(0);
  });

  it('askName: nome comum não chama a IA', async () => {
    const { fake, out } = await run('askName', 'Maria da Silva', { customer: {} });
    expect(out?.state?.step).toBe('askCpf');
    expect(interpretCalls(fake)).toHaveLength(0);
  });

  it('askName: pedido chama a IA', async () => {
    const { fake } = await run('askName', 'quero 2 botijão', { customer: {} });
    expect(interpretCalls(fake)).toHaveLength(1);
  });

  it('askCpf', async () => {
    const valid = await run('askCpf', '123.456.789-09');
    expect(interpretCalls(valid.fake)).toHaveLength(0);

    for (const bad of ['123', 'meu cpf é 123.456.789-00']) {
      const { fake, out } = await run('askCpf', bad);
      expect(out?.replies).toEqual([text(msg.invalidCpf)]);
      expect(interpretCalls(fake)).toHaveLength(0);
    }

    const { fake } = await run('askCpf', 'quero no pix');
    expect(interpretCalls(fake)).toHaveLength(1);
  });

  it('confirmCpf', async () => {
    const valid = await run('confirmCpf', '123.456.789-09');
    expect(interpretCalls(valid.fake)).toHaveLength(0);

    for (const bad of ['111.222.333-44', 'meu cpf é 123.456.789-00']) {
      const { fake, out } = await run('confirmCpf', bad);
      expect(out?.replies).toEqual([
        buttons(msg.invalidCpf, [{ id: 'identity:agent', title: msg.talkToAgent }]),
      ]);
      expect(interpretCalls(fake)).toHaveLength(0);
    }

    const { fake, out } = await run('confirmCpf', 'quero no pix');
    expect(interpretCalls(fake)).toHaveLength(0);
    expect(out?.state?.step).toBe('confirmCpf');
  });

  it.each([
    ['askQuantity', msg.invalidQuantity],
    ['askChangeAmount', msg.invalidChange(110)],
  ] as [Step, string][])('%s: número inválido sem IA e texto com IA', async (step, error) => {
    const bad = await run(step, '0');
    expect(bad.out?.replies).toEqual([text(error)]);
    expect(interpretCalls(bad.fake)).toHaveLength(0);

    for (const loose of ['quero no pix', 'abc']) {
      const { fake } = await run(step, loose);
      expect(interpretCalls(fake)).toHaveLength(1);
    }
  });

  it.each([
    'creatingSale',
    'saleFailed',
    'searchProduct',
    'askNewAddress',
    'askAddressField',
  ] as Step[])('%s nunca chama a IA', async step => {
    const { fake } = await run(step, 'quero 3 botijões no pix');
    expect(interpretCalls(fake)).toHaveLength(0);
  });
});
