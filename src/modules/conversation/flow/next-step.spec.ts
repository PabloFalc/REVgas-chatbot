import { describe, expect, it } from 'vitest';
import type { OrderState } from './flow.types';
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
});
