import {
  type FlowTools,
  MAX_QUANTITY,
  type OrderState,
  type Step,
  type StepResult,
} from './flow.types';
import { offer } from './handoff';
import { msg } from './messages';
import { text } from './replies';
import { asks } from './steps/registry';

async function goTo(state: OrderState, step: Step, tools: FlowTools): Promise<StepResult> {
  const next = { ...state, step };
  const ask = asks[step];
  if (!ask) return { state: next, replies: [] };
  return ask(next, tools);
}

function withoutQuantity(state: OrderState): OrderState {
  const { quantity: _quantity, quote: _quote, ...rest } = state;
  return rest;
}

async function checkQuantity(state: OrderState, tools: FlowTools): Promise<StepResult | null> {
  const { product, quantity } = state;
  if (!product || quantity === undefined) return null;
  const stock = product.stock;
  if (stock !== undefined && quantity > stock) {
    const result = await goTo(withoutQuantity(state), 'chooseQuantity', tools);
    return {
      state: result.state,
      replies: [text(msg.stockLimit(stock, product.name)), ...result.replies],
    };
  }
  if (quantity > MAX_QUANTITY) {
    const result = await goTo(withoutQuantity(state), 'chooseQuantity', tools);
    return { state: result.state, replies: [offer(msg.quantityAboveMax), ...result.replies] };
  }
  return null;
}

function needsChange(state: OrderState): boolean {
  if (state.payment?.type !== 'MONEY' || !state.quote) return false;
  if (state.changeFor === undefined) return true;
  return state.changeFor !== null && state.changeFor <= state.quote.total;
}

export async function nextStep(state: OrderState, tools: FlowTools): Promise<StepResult> {
  if (!state.address) {
    if (state.draftAddress) return goTo(state, 'askAddressField', tools);
    if (state.pendingAddressText) return goTo(state, 'askNewAddress', tools);
    return goTo(state, state.addresses?.length ? 'chooseAddress' : 'askNewAddress', tools);
  }
  if (!state.product) {
    return goTo(state, state.productCandidates?.length ? 'pickProduct' : 'chooseProduct', tools);
  }
  if (!state.quantity) return goTo(state, 'chooseQuantity', tools);
  const quantityResult = await checkQuantity(state, tools);
  if (quantityResult) return quantityResult;
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
