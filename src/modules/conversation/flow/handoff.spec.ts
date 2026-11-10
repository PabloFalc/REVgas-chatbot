import type { HandoffOutcome } from 'src/modules/handoff/contracts/handoff.types';
import { describe, expect, it } from 'vitest';
import type { OrderState } from './flow.types';
import { HANDOFF_CHOICE, handoff, handoffButton, handoffSummary } from './handoff';
import { msg } from './messages';
import { text } from './replies';
import { createFakeTools, FAKE_PHONE } from './testing/fake-tools';

const state: OrderState = { step: 'askName', customer: {} };

function toolsReturning(outcome: HandoffOutcome) {
  return createFakeTools({ requestHandoff: async () => outcome });
}

describe('handoffButton', () => {
  it('usa o id fixo e o rótulo', () => {
    expect(handoffButton()).toEqual({ id: HANDOFF_CHOICE, title: msg.talkToAgent });
    expect(HANDOFF_CHOICE).toBe('handoff:request');
  });
});

describe('handoff', () => {
  it('na fila e aberto responde handoffQueued e mantém o estado', async () => {
    const result = await handoff(state, FAKE_PHONE, 'customer_request', createFakeTools());
    expect(result).toEqual({ state, replies: [text(msg.handoffQueued)] });
  });

  it('envia telefone, motivo e resumo', async () => {
    const tools = createFakeTools();
    await handoff(state, FAKE_PHONE, 'sale_failed', tools);
    expect(tools.calls[0]).toEqual({
      name: 'requestHandoff',
      args: [{ phone: FAKE_PHONE, reason: 'sale_failed', summary: handoffSummary(state) }],
    });
  });

  it.each(['alreadyQueued', 'active'] as const)(
    '%s responde handoffAlreadyQueued',
    async status => {
      const tools = toolsReturning({ status, open: true, nextOpening: null });
      const result = await handoff(state, FAKE_PHONE, 'customer_request', tools);
      expect(result.replies).toEqual([text(msg.handoffAlreadyQueued)]);
    },
  );

  it('unavailable mostra o telefone da revenda', async () => {
    const tools = createFakeTools({
      requestHandoff: async () => ({ status: 'unavailable', open: true, nextOpening: null }),
      storePhone: '86999990000',
    });
    const result = await handoff(state, FAKE_PHONE, 'customer_request', tools);
    expect(result).toEqual({ state, replies: [text(msg.talkToStore('86999990000'))] });
  });

  it('na fila e fechado informa quando abre', async () => {
    const nextOpening = { weekday: 1, time: '08:00', inDays: 2 };
    const tools = toolsReturning({ status: 'queued', open: false, nextOpening });
    const result = await handoff(state, FAKE_PHONE, 'customer_request', tools);
    expect(result.replies).toEqual([text(msg.handoffClosed(nextOpening))]);
    expect(msg.handoffClosed(nextOpening)).toContain('Abrimos segunda às 8h');
  });

  it('fechado sem próxima abertura usa o texto curto', async () => {
    const tools = toolsReturning({ status: 'queued', open: false, nextOpening: null });
    const result = await handoff(state, FAKE_PHONE, 'customer_request', tools);
    expect(result.replies).toEqual([text(msg.handoffClosed(null))]);
  });
});

describe('handoffClosed', () => {
  it('amanhã com minutos', () => {
    expect(msg.handoffClosed({ weekday: 3, time: '08:30', inDays: 1 })).toContain('amanhã às 8h30');
  });

  it('hoje', () => {
    expect(msg.handoffClosed({ weekday: 3, time: '08:00', inDays: 0 })).toContain('hoje às 8h');
  });
});

describe('handoffSummary', () => {
  it('sem estado devolve null', () => {
    expect(handoffSummary(null)).toBeNull();
  });

  it('askCpfPrefix não revela nome nem CPF', () => {
    const current: OrderState = {
      step: 'askCpfPrefix',
      customer: { id: 1, name: 'Maria da Silva', cpf: '12345678909' },
    };
    const summary = handoffSummary(current);
    expect(summary).toEqual({
      stepLabel: 'Confirmação de identidade',
      identityConfirmed: false,
      newCustomer: false,
    });
    expect(JSON.stringify(summary)).not.toContain('12345678909');
  });

  it('resumo completo traz produto, quantidade, endereço, pagamento e total', () => {
    const current: OrderState = {
      step: 'summary',
      customer: { id: 1, name: 'Maria da Silva', cpf: '12345678909' },
      product: { id: 1, name: 'Botijão P13' },
      quantity: 2,
      address: {
        street: 'Rua das Flores',
        number: '120',
        neighborhood: 'Centro',
        city: 'Teresina',
        state: 'PI',
      },
      payment: { type: 'MONEY', label: 'Dinheiro' },
      changeFor: 300,
      quote: { unitPrice: 110, total: 220 },
    };
    const summary = handoffSummary(current);
    expect(summary).toMatchObject({
      stepLabel: 'Resumo do pedido',
      identityConfirmed: true,
      newCustomer: false,
      customerName: 'Maria da Silva',
      product: 'Botijão P13',
      quantity: 2,
      address: msg.addressFull(current.address as never),
      total: 220,
    });
    expect(summary?.payment).toContain('Dinheiro (troco para');
    expect(JSON.stringify(summary)).not.toContain('12345678909');
  });

  it('cliente sem id é novo', () => {
    expect(handoffSummary({ step: 'askName', customer: {} })).toMatchObject({
      stepLabel: 'Nome do cliente',
      newCustomer: true,
      identityConfirmed: true,
    });
  });

  it('saleFailed tem rótulo próprio', () => {
    expect(handoffSummary({ step: 'saleFailed', customer: { id: 1 } })?.stepLabel).toBe(
      'Falha ao criar a venda',
    );
  });
});
