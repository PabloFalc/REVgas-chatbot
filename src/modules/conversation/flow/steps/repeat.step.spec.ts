import type { LastOrder } from 'src/modules/customer/contracts/customer.types';
import { describe, expect, it } from 'vitest';
import type { FlowInput, OrderState } from '../flow.types';
import { msg } from '../messages';
import { nextStep } from '../next-step';
import { buttons } from '../replies';
import { createFakeTools, FAKE_PHONE } from '../testing/fake-tools';
import { handlers } from './index';
import { offerOrNext } from './repeat.step';

const address = {
  street: 'Rua das Flores',
  number: '120',
  neighborhood: 'Centro',
  city: 'Teresina',
  state: 'PI',
};

const lastOrder: LastOrder = { productId: 1, quantity: 1, paymentType: 'PIX', address };

const base: OrderState = {
  step: 'askCpfPrefix',
  customer: { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: null },
  addresses: [address],
  lastOrder,
};

const pick = (id: string): FlowInput => ({
  phone: FAKE_PHONE,
  content: { type: 'choice', id, title: id },
});

const say = (body: string): FlowInput => ({
  phone: FAKE_PHONE,
  content: { type: 'text', text: body },
});

const answer = (
  state: OrderState | null,
  input: FlowInput,
  tools: ReturnType<typeof createFakeTools>,
) => handlers.offerRepeat?.(state as OrderState, input, tools);

describe('offerOrNext', () => {
  it('oferece com o pedido e os botões', async () => {
    const result = await offerOrNext(base, createFakeTools());
    const offer = result.state?.repeatOffer;
    expect(offer).toBeDefined();
    if (!offer) return;
    expect(result.state?.step).toBe('offerRepeat');
    expect(result.replies).toEqual([
      buttons(msg.offerRepeat(offer), [
        { id: 'repeat:yes', title: 'Repetir' },
        { id: 'repeat:new', title: 'Novo pedido' },
      ]),
    ]);
    expect(msg.offerRepeat(offer)).toContain('1× Botijão P13 · Pix');
  });

  it('Repetir vai ao resumo com o preço do quote de hoje', async () => {
    const tools = createFakeTools();
    const offered = await offerOrNext(base, tools);
    const result = await answer(offered.state, pick('repeat:yes'), tools);
    expect(result?.state?.step).toBe('summary');
    expect(result?.state?.quote?.total).toBe(110);
    expect(result?.state?.address).toEqual(address);
    expect(tools.calls.some(call => call.name === 'createSale')).toBe(false);
  });

  it('Repetir em dinheiro pergunta o troco', async () => {
    const tools = createFakeTools();
    const offered = await offerOrNext(
      { ...base, lastOrder: { ...lastOrder, paymentType: 'MONEY' } },
      tools,
    );
    const result = await answer(offered.state, pick('repeat:yes'), tools);
    expect(result?.state?.step).toBe('askNeedsChange');
  });

  it('Novo pedido segue o fluxo normal', async () => {
    const tools = createFakeTools();
    const offered = await offerOrNext(base, tools);
    const result = await answer(offered.state, pick('repeat:new'), tools);
    expect(result?.state?.step).toBe('chooseAddress');
    expect(result?.state?.product).toBeUndefined();
  });

  describe('não oferece', () => {
    const expectPlain = async (
      state: OrderState,
      overrides: Parameters<typeof createFakeTools>[0],
    ) => {
      const result = await offerOrNext(state, createFakeTools(overrides));
      const plain = await nextStep(state, createFakeTools(overrides));
      expect(result).toEqual(plain);
      expect(result.state?.step).not.toBe('offerRepeat');
    };

    it('produto fora de listProducts', async () => {
      await expectPlain(base, { listProducts: async () => [{ id: 2, name: 'Botijão P45' }] });
    });

    it('pagamento fora de listPaymentOptions', async () => {
      await expectPlain(base, {
        listPaymentOptions: async () => [{ type: 'MONEY', label: 'Dinheiro' }],
      });
    });

    it('quote nulo', async () => {
      await expectPlain(base, { quote: async () => null });
    });

    it('estado já tem produto vindo de texto livre', async () => {
      await expectPlain({ ...base, product: { id: 2, name: 'Botijão P45' } }, {});
    });
  });

  it('texto digitado na oferta passa pela IA', async () => {
    const tools = createFakeTools({
      interpret: async () => ({
        intent: 'order',
        confidence: 0.9,
        products: ['Botijão P13'],
        quantity: 3,
      }),
    });
    const offered = await offerOrNext(base, tools);
    const result = await answer(offered.state, say('quero 3'), tools);
    expect(result?.replies[0]).toEqual({ type: 'text', text: msg.noted(['3x Botijão P13']) });
    expect(result?.state?.quantity).toBe(3);
  });
});
