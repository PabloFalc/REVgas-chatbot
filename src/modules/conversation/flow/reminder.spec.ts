import { describe, expect, it } from 'vitest';
import type { OrderState } from './flow.types';
import { msg } from './messages';
import { REMINDER_AFTER_MS, reminderFor } from './reminder';
import { text } from './replies';
import { createFakeTools } from './testing/fake-tools';

const at = (time: string) => new Date(`2026-10-21T${time}:00-03:00`).toISOString();

function idle(state: Partial<OrderState>, lastInboundAt = at('11:49')): OrderState {
  return { step: 'choosePayment', customer: { id: 1, name: 'Maria' }, lastInboundAt, ...state };
}

describe('reminderFor', () => {
  it('lembra depois de 10 minutos', () => {
    expect(REMINDER_AFTER_MS).toBe(600_000);
  });

  it('manda o lembrete e a pergunta da etapa com botões', async () => {
    const state = idle({});
    const result = await reminderFor(state, createFakeTools());

    expect(result?.replies[0]).toEqual(text(msg.reminder));
    expect(result?.replies[1].type).toBe('buttons');
    expect(result?.state?.remindedFor).toBe(state.lastInboundAt);
    expect(result?.state?.step).toBe('choosePayment');
  });

  it('nada antes dos 10 min', async () => {
    expect(await reminderFor(idle({}, at('11:51')), createFakeTools())).toBeNull();
  });

  it('nada sem horário da última mensagem', async () => {
    expect(
      await reminderFor({ step: 'choosePayment', customer: {} }, createFakeTools()),
    ).toBeNull();
  });

  it('nada em creatingSale', async () => {
    expect(await reminderFor(idle({ step: 'creatingSale' }), createFakeTools())).toBeNull();
  });

  it('um lembrete por período parado', async () => {
    const state = idle({});
    expect(
      await reminderFor({ ...state, remindedFor: state.lastInboundAt }, createFakeTools()),
    ).toBeNull();
  });

  it('lembra também em askCpfPrefix e saleFailed', async () => {
    const prefix = await reminderFor(idle({ step: 'askCpfPrefix' }), createFakeTools());
    expect(prefix?.replies).toEqual([text(msg.reminder), text(msg.askCpfPrefix)]);

    const failed = await reminderFor(idle({ step: 'saleFailed' }), createFakeTools());
    expect(failed?.replies[0]).toEqual(text(msg.reminder));
    expect(failed?.replies[1]).toMatchObject({ type: 'buttons', body: msg.saleFailed });
  });
});
