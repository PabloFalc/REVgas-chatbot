import { describe, expect, it } from 'vitest';
import { runFlow } from './flow';
import type { FlowInput, OrderState } from './flow.types';
import { msg } from './messages';
import { createFakeTools, FAKE_PHONE } from './testing/fake-tools';

const hello: FlowInput = { phone: FAKE_PHONE, content: { type: 'text', text: 'oi' } };

describe('runFlow', () => {
  it('sem pedido em andamento, comando global vence', async () => {
    const result = await runFlow(
      null,
      { ...hello, content: { type: 'text', text: 'cancelar' } },
      createFakeTools(),
    );
    expect(result).toEqual({ state: null, replies: [msg.cancelled] });
  });

  it('erro numa ferramenta sem pedido em andamento devolve indisponível', async () => {
    const tools = createFakeTools({
      findCustomer: async () => {
        throw new Error('RevGás fora do ar');
      },
    });
    const result = await runFlow(null, hello, tools);
    expect(result).toEqual({ state: null, replies: [msg.unavailable] });
  });

  it('erro numa ferramenta mantém o estado recebido', async () => {
    const state: OrderState = { step: 'askName', customer: {} };
    const tools = createFakeTools({
      findCustomer: async () => {
        throw new Error('RevGás fora do ar');
      },
    });
    const result = await runFlow(state, { ...hello, content: { type: 'unsupported' } }, tools);
    expect(result.state).toBe(state);
    expect(result.replies).toEqual([msg.textOnly]);
  });
});
