import { describe, expect, it } from 'vitest';
import { MAX_QUANTITY, type OrderState } from './flow.types';
import { HANDOFF_CHOICE, offer } from './handoff';
import { msg } from './messages';
import { nextStep } from './next-step';
import { text } from './replies';
import './steps';
import { createFakeTools } from './testing/fake-tools';

const address = {
  street: 'Rua A',
  number: '1',
  neighborhood: 'Centro',
  city: 'Teresina',
  state: 'PI',
};
const product = { id: 1, name: 'Botijão P13' };
const pix = { type: 'PIX', label: 'Pix' };
const money = { type: 'MONEY', label: 'Dinheiro' };

function stateWith(extra: Partial<OrderState>): OrderState {
  return { step: 'summary', customer: { id: 1 }, ...extra };
}

function purchaseStarts(tools: ReturnType<typeof createFakeTools>) {
  return tools.calls.filter(
    call => call.name === 'track' && (call.args[0] as { name: string }).name === 'purchase_started',
  );
}

describe('nextStep', () => {
  it('sem endereço e com endereços conhecidos escolhe o endereço', async () => {
    const result = await nextStep(stateWith({ addresses: [address] }), createFakeTools());
    expect(result.state?.step).toBe('chooseAddress');
  });

  it('sem endereço e sem endereços conhecidos pede endereço novo', async () => {
    const result = await nextStep(stateWith({}), createFakeTools());
    expect(result.state?.step).toBe('askNewAddress');
  });

  it('segue produto, quantidade e pagamento nessa ordem', async () => {
    const tools = createFakeTools();
    expect((await nextStep(stateWith({ address }), tools)).state?.step).toBe('chooseProduct');
    expect((await nextStep(stateWith({ address, product }), tools)).state?.step).toBe(
      'chooseQuantity',
    );
    expect((await nextStep(stateWith({ address, product, quantity: 2 }), tools)).state?.step).toBe(
      'choosePayment',
    );
  });

  it('quantidade acima do estoque avisa e volta à quantidade', async () => {
    const limited = { ...product, stock: 3 };
    const result = await nextStep(
      stateWith({
        address,
        product: limited,
        quantity: 5,
        payment: pix,
        quote: { unitPrice: 110, total: 550 },
      }),
      createFakeTools(),
    );
    expect(result.state?.step).toBe('chooseQuantity');
    expect(result.state?.quantity).toBeUndefined();
    expect(result.state?.quote).toBeUndefined();
    expect(result.replies[0]).toEqual(text(msg.stockLimit(3, limited.name)));
  });

  it('quantidade acima do máximo oferece atendente e volta à quantidade', async () => {
    const result = await nextStep(
      stateWith({
        address,
        product,
        quantity: MAX_QUANTITY + 1,
        payment: pix,
        quote: { unitPrice: 110, total: 1210 },
      }),
      createFakeTools(),
    );
    expect(result.state?.step).toBe('chooseQuantity');
    expect(result.state?.quantity).toBeUndefined();
    expect(result.state?.quote).toBeUndefined();
    expect(result.replies[0]).toEqual(offer(msg.quantityAboveMax));
    const reply = result.replies[0];
    if (reply?.type !== 'buttons') throw new Error('expected buttons');
    expect(reply.buttons.map(button => button.id)).toEqual([HANDOFF_CHOICE]);
  });

  it('com tudo escolhido calcula o preço e vai ao resumo', async () => {
    const tools = createFakeTools();
    const result = await nextStep(
      stateWith({ address, product, quantity: 2, payment: pix }),
      tools,
    );
    expect(result.state?.step).toBe('summary');
    expect(result.state?.quote).toEqual({ unitPrice: 110, total: 220 });
  });

  it('sem preço para a forma de pagamento limpa o pagamento e avisa', async () => {
    const tools = createFakeTools({ quote: async () => null });
    const result = await nextStep(
      stateWith({ address, product, quantity: 1, payment: pix }),
      tools,
    );
    expect(result.state?.step).toBe('choosePayment');
    expect(result.state?.payment).toBeUndefined();
    expect(result.replies[0]).toEqual(text(msg.noPriceForPayment));
  });

  it('forma que deixou de ter preço sai das opções reapresentadas', async () => {
    const tools = createFakeTools({
      quote: async (_customer, _productId, paymentType, quantity) =>
        paymentType === 'PIX' ? null : { unitPrice: 110, total: 110 * quantity },
    });
    const result = await nextStep(
      stateWith({ address, product, quantity: 1, payment: pix }),
      tools,
    );
    expect(result.state?.payment).toBeUndefined();
    expect(result.state?.quote).toBeUndefined();
    expect(result.state?.paymentOptions?.map(option => option.type)).toEqual([
      'MONEY',
      'CARTAO_DE_CREDITO',
    ]);
  });

  it('dinheiro sem troco informado pergunta o troco', async () => {
    const result = await nextStep(
      stateWith({ address, product, quantity: 1, payment: money }),
      createFakeTools(),
    );
    expect(result.state?.step).toBe('askNeedsChange');
  });

  it('dinheiro sem precisar de troco vai ao resumo', async () => {
    const result = await nextStep(
      stateWith({ address, product, quantity: 1, payment: money, changeFor: null }),
      createFakeTools(),
    );
    expect(result.state?.step).toBe('summary');
  });

  it('troco menor ou igual ao novo total pergunta de novo', async () => {
    const result = await nextStep(
      stateWith({ address, product, quantity: 2, payment: money, changeFor: 200 }),
      createFakeTools(),
    );
    expect(result.state?.step).toBe('askNeedsChange');
  });

  it('troco maior que o total vai ao resumo', async () => {
    const result = await nextStep(
      stateWith({ address, product, quantity: 1, payment: money, changeFor: 150 }),
      createFakeTools(),
    );
    expect(result.state?.step).toBe('summary');
  });

  it('retoma o rascunho completo', async () => {
    const result = await nextStep(stateWith({ draftAddress: address }), createFakeTools());
    expect(result.state?.step).toBe('confirmAddress');
  });

  it('retoma o rascunho com campo faltando', async () => {
    const { number: _number, ...draftAddress } = address;
    const result = await nextStep(stateWith({ draftAddress }), createFakeTools());
    expect(result.state?.step).toBe('askAddressField');
    expect(result.state?.missingField).toBe('number');
  });

  it('usa o texto de endereço pendente antes dos endereços salvos', async () => {
    const tools = createFakeTools();
    const result = await nextStep(
      stateWith({ addresses: [address, address], pendingAddressText: 'rua b 10' }),
      tools,
    );
    expect(tools.calls).toEqual([{ name: 'addressFromText', args: ['rua b 10'] }]);
    expect(result.state?.step).toBe('confirmAddress');
    expect(result.state?.pendingAddressText).toBeUndefined();
  });

  it('mostra os candidatos quando o produto é ambíguo', async () => {
    const productCandidates = [
      { id: 1, name: 'Botijão P13' },
      { id: 2, name: 'Botijão P45' },
    ];
    const result = await nextStep(stateWith({ address, productCandidates }), createFakeTools());
    expect(result.state?.step).toBe('pickProduct');
    const reply = result.replies[0];
    if (reply?.type !== 'list') throw new Error('expected list');
    expect(reply.body).toBe(msg.chooseAmbiguousProduct);
    expect(reply.sections[0].rows.map(row => row.id)).toEqual(['product:1', 'product:2']);
  });
  it('emite purchase_started com o segmento do cliente quando endereço e produto estão definidos', async () => {
    const segments: { extra: Partial<OrderState>; reason: string }[] = [
      { extra: {}, reason: 'new' },
      { extra: { boughtProductIds: [] }, reason: 'unknown' },
      { extra: { boughtProductIds: [1] }, reason: 'recurring' },
    ];
    for (const { extra, reason } of segments) {
      const tools = createFakeTools();
      const result = await nextStep(stateWith({ address, product, ...extra }), tools);
      expect(purchaseStarts(tools).map(call => call.args[0])).toEqual([
        { name: 'purchase_started', reason },
      ]);
      expect(result.state?.purchaseStarted).toBe(true);
      expect(result.state?.step).toBe('chooseQuantity');
    }
  });

  it('emite purchase_started uma única vez por ciclo', async () => {
    const tools = createFakeTools();
    const first = await nextStep(stateWith({ address, product, quantity: 2, payment: pix }), tools);
    expect(first.state?.step).toBe('summary');
    const {
      product: _product,
      quantity: _quantity,
      quote: _quote,
      ...back
    } = first.state as OrderState;
    const second = await nextStep({ ...back, product: { ...product, id: 2 }, quantity: 3 }, tools);
    expect(second.state?.step).toBe('summary');
    expect(second.state?.quote?.total).toBe(330);
    expect(purchaseStarts(tools)).toHaveLength(1);
  });

  it('não emite purchase_started enquanto faltam endereço ou produto', async () => {
    const tools = createFakeTools();
    const noAddress = await nextStep(stateWith({ product }), tools);
    const noProduct = await nextStep(stateWith({ address }), tools);
    expect(purchaseStarts(tools)).toHaveLength(0);
    expect(noAddress.state?.purchaseStarted).toBeUndefined();
    expect(noProduct.state?.purchaseStarted).toBeUndefined();
  });
});

it.each([
  { reason: 'max', stock: 50, quantity: 11 },
  { reason: 'stock', stock: 1, quantity: 2 },
])('registra limite $reason', async ({ reason, stock, quantity }) => {
  const tools = createFakeTools();
  await nextStep(stateWith({ address, product: { id: 1, name: 'P13', stock }, quantity }), tools);
  expect(tools.calls).toContainEqual({ name: 'track', args: [{ name: 'quantity_limit', reason }] });
});
