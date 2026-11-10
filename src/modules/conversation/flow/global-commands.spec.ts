import { afterEach, describe, expect, it } from 'vitest';
import type { FlowInput, OrderState } from './flow.types';
import { globalCommand } from './global-commands';
import { msg } from './messages';
import { text } from './replies';
import { asks } from './steps';
import { createFakeTools, FAKE_PHONE } from './testing/fake-tools';

const state: OrderState = { step: 'askName', customer: {} };
const question = { type: 'text', text: 'pergunta da etapa' } as const;

function say(value: string): FlowInput {
  return { phone: FAKE_PHONE, content: { type: 'text', text: value } };
}

const originalAsk = asks.askName;

afterEach(() => {
  asks.askName = originalAsk;
});

describe('globalCommand', () => {
  it('cancelar durante creatingSale mantém o pedido e avisa que está em andamento', async () => {
    const creating: OrderState = { step: 'creatingSale', customer: {} };
    const result = await globalCommand(creating, say('cancelar'), createFakeTools());
    expect(result).toEqual({ state: creating, replies: [text(msg.saleInProgress)] });
  });

  it('cancelar em saleFailed com venda já criada devolve o número da venda', async () => {
    const failed: OrderState = {
      step: 'saleFailed',
      customer: { id: 1 },
      address: {
        street: 'Rua A',
        number: '1',
        neighborhood: 'Centro',
        city: 'Teresina',
        state: 'PI',
      },
      product: { id: 1, name: 'Botijão P13' },
      quantity: 1,
      payment: { type: 'PIX', label: 'Pix' },
      quote: { unitPrice: 110, total: 110 },
      saleAttemptAt: '2026-10-21T15:00:00.000Z',
    };
    const found = await globalCommand(
      failed,
      say('cancelar'),
      createFakeTools({ findRecentSale: async () => 321 }),
    );
    expect(found).toEqual({ state: null, replies: [text(msg.saleCreated(321))], saleId: 321 });
    const none = await globalCommand(failed, say('cancelar'), createFakeTools());
    expect(none).toEqual({ state: null, replies: [text(msg.cancelled)] });
  });

  it.each(['cancelar', 'Cancelar', 'CANCELA', 'cancelar pedido'])(
    '%s apaga o pedido',
    async word => {
      const result = await globalCommand(state, say(word), createFakeTools());
      expect(result).toEqual({ state: null, replies: [text(msg.cancelled)] });
    },
  );

  it('cancelar dentro de uma frase maior não cancela', async () => {
    expect(
      await globalCommand(state, say('não quero cancelar nada'), createFakeTools()),
    ).toBeNull();
  });

  it.each(['atendente', 'quero falar com um atendente', 'Humano'])(
    '%s pede atendente e mantém o estado',
    async word => {
      const tools = createFakeTools();
      const result = await globalCommand(state, say(word), tools);
      expect(result).toEqual({ state, replies: [text(msg.handoffQueued)] });
      expect(tools.calls[0].args[0]).toMatchObject({
        phone: FAKE_PHONE,
        reason: 'customer_request',
      });
    },
  );

  it('botão de atendente em saleFailed usa o motivo sale_failed', async () => {
    const failed: OrderState = { step: 'saleFailed', customer: { id: 1 } };
    const tools = createFakeTools();
    const result = await globalCommand(
      failed,
      { phone: FAKE_PHONE, content: { type: 'choice', id: 'handoff:request' } },
      tools,
    );
    expect(result?.state).toEqual(failed);
    expect(tools.calls[0].args[0]).toMatchObject({ reason: 'sale_failed' });
  });

  it('botão de atendente em outra etapa usa customer_request', async () => {
    const tools = createFakeTools();
    await globalCommand(
      state,
      { phone: FAKE_PHONE, content: { type: 'choice', id: 'handoff:request' } },
      tools,
    );
    expect(tools.calls[0].args[0]).toMatchObject({ reason: 'customer_request' });
  });

  it('atendente indisponível mostra o telefone da revenda', async () => {
    const tools = createFakeTools({
      requestHandoff: async () => ({ status: 'unavailable', open: true, nextOpening: null }),
    });
    const result = await globalCommand(null, say('atendente'), tools);
    expect(result).toEqual({ state: null, replies: [text(msg.talkToStore('86999990000'))] });
  });

  it.each(['desconto', 'tem promoção?', 'tem mais barato'])(
    '%s responde e repete a pergunta',
    async word => {
      asks.askName = async current => ({ state: current, replies: [question] });
      const result = await globalCommand(state, say(word), createFakeTools());
      expect(result).toEqual({ state, replies: [text(msg.noDiscount), question] });
    },
  );

  it('mantém o estado devolvido pela pergunta da etapa', async () => {
    const refreshed: OrderState = { ...state, boughtProductIds: [7] };
    asks.askName = async () => ({ state: refreshed, replies: [question] });
    const result = await globalCommand(state, say('desconto'), createFakeTools());
    expect(result?.state).toBe(refreshed);
  });

  it('desconto sem pedido em andamento responde só o aviso', async () => {
    const result = await globalCommand(null, say('desconto'), createFakeTools());
    expect(result).toEqual({ state: null, replies: [text(msg.noDiscount)] });
  });

  it('mídia não suportada avisa e repete a pergunta', async () => {
    asks.askName = async current => ({ state: current, replies: [question] });
    const result = await globalCommand(
      state,
      { phone: FAKE_PHONE, content: { type: 'unsupported' } },
      createFakeTools(),
    );
    expect(result).toEqual({ state, replies: [text(msg.textOnly), question] });
  });

  it('áudio sem pedido em andamento começa pela saudação', async () => {
    const result = await globalCommand(
      null,
      { phone: '5500000000000', content: { type: 'unsupported' } },
      createFakeTools(),
    );
    expect(result?.replies).toEqual([text(msg.welcomeNew)]);
  });

  it('texto comum e botão não são comandos globais', async () => {
    const tools = createFakeTools();
    expect(await globalCommand(state, say('Maria da Silva'), tools)).toBeNull();
    const button = { phone: FAKE_PHONE, content: { type: 'choice', id: 'qty:1' } } as const;
    expect(await globalCommand(state, button, tools)).toBeNull();
  });
});
