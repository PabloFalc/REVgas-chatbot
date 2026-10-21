import type { FlowTools, OrderState, Step, StepResult } from './flow.types';
import { msg } from './messages';
import { text } from './replies';
import { asks } from './steps';

async function goTo(state: OrderState, step: Step, tools: FlowTools): Promise<StepResult> {
  const next = { ...state, step };
  const ask = asks[step];
  if (!ask) return { state: next, replies: [] };
  return ask(next, tools);
}

function needsChange(state: OrderState): boolean {
  if (state.payment?.type !== 'MONEY' || !state.quote) return false;
  if (state.changeFor === undefined) return true;
  return state.changeFor !== null && state.changeFor <= state.quote.total;
}

export async function nextStep(state: OrderState, tools: FlowTools): Promise<StepResult> {
  if (!state.address) {
    return goTo(state, state.addresses?.length ? 'chooseAddress' : 'askNewAddress', tools);
  }
  if (!state.product) return goTo(state, 'chooseProduct', tools);
  if (!state.quantity) return goTo(state, 'chooseQuantity', tools);
  if (!state.payment) return goTo(state, 'choosePayment', tools);

  let current = state;
  if (!current.quote) {
    const quote = await tools.quote(
      { id: current.customer.id, tagId: current.customer.tagId },
      current.product?.id ?? 0,
      current.payment?.type ?? '',
      current.quantity ?? 0,
    );
    if (!quote) {
      const { payment: _payment, ...rest } = current;
      const result = await goTo(rest, 'choosePayment', tools);
      return { state: result.state, replies: [text(msg.noPriceForPayment), ...result.replies] };
    }
    current = { ...current, quote };
  }

  return goTo(current, needsChange(current) ? 'askNeedsChange' : 'summary', tools);
}
