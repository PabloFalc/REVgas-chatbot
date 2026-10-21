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

  it.each(['atendente', 'quero falar com alguém', 'Humano'])(
    '%s mostra o telefone da revenda',
    async word => {
      const tools = createFakeTools({ storePhone: '86988887777' });
      const result = await globalCommand(state, say(word), tools);
      expect(result).toEqual({ state, replies: [text(msg.talkToStore('86988887777'))] });
    },
  );

  it('atendente sem telefone da revenda usa o texto genérico', async () => {
    const tools = createFakeTools({ storePhone: undefined });
    const result = await globalCommand(null, say('atendente'), tools);
    expect(result).toEqual({ state: null, replies: [text(msg.talkToStore())] });
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
