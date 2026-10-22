import type { Interpretation } from 'src/modules/assistant/contracts/assistant.types';
import { describe, expect, it } from 'vitest';
import type { OrderState } from './flow.types';
import { applyInterpretation, type Catalog, looksLikeOrder, shouldInterpret } from './free-text';
import { msg } from './messages';

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
  it.each(['123.456', '12 3', 'R$ 100,00', 'meu cpf é 123'])('false: %s', text => {
    expect(shouldInterpret(text)).toBe(false);
  });

  it.each(['quero 3 botijões', 'paga no pix'])('true: %s', text => {
    expect(shouldInterpret(text)).toBe(true);
  });
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

  it('offTopic indica a revenda', () => {
    expect(msg.offTopic('86999990000')).toBe(
      'Essa dúvida eu não consigo responder por aqui. Fale com a revenda: 86999990000.',
    );
  });

  it('textos fixos', () => {
    expect(msg.notUnderstood).toBe('Não entendi.');
    expect(msg.chooseAmbiguousProduct).toBe('Qual desses você quer?');
  });
});
