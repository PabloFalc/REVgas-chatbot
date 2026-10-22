import { type SaleOrder, SaleRejectedError } from 'src/modules/order/contracts/order.types';
import { formatMoney } from 'src/utils/money';
import {
  type AskFn,
  type FlowTools,
  type HandleFn,
  type OrderState,
  type Step,
  type StepResult,
  ToolError,
} from '../flow.types';
import { choiceOf } from '../input';
import { msg } from '../messages';
import { nextStep } from '../next-step';
import { buttons, text } from '../replies';

const STALE_ATTEMPT_MS = 60_000;

function buildOrder(state: OrderState): SaleOrder | null {
  const { customer, address, product, quantity, payment, quote } = state;
  if (customer.id === undefined || !address || !product || !quantity || !payment || !quote) {
    return null;
  }
  return {
    customerId: customer.id,
    address,
    productId: product.id,
    productName: product.name,
    quantity,
    unitPrice: quote.unitPrice,
    paymentType: payment.type,
    total: quote.total,
    ...(typeof state.changeFor === 'number'
      ? { observation: `Troco para ${formatMoney(state.changeFor)}` }
      : {}),
  };
}

const summary: AskFn = async state => ({
  state: { ...state, step: 'summary' },
  replies: [
    buttons(msg.summary(state), [
      { id: 'summary:confirm', title: msg.confirm },
      { id: 'summary:fix', title: msg.fix },
    ]),
  ],
});

const chooseCorrection: AskFn = async state => ({
  state: { ...state, step: 'chooseCorrection' },
  replies: [
    buttons(msg.chooseCorrection, [
      { id: 'fix:product', title: msg.fixProduct },
      { id: 'fix:address', title: msg.fixAddress },
      { id: 'fix:payment', title: msg.fixPayment },
    ]),
  ],
});

const creatingSale: AskFn = async state => ({
  state: { ...state, step: 'creatingSale' },
  replies: [text(msg.saleInProgress)],
});

const saleFailed: AskFn = async state => ({
  state: { ...state, step: 'saleFailed' },
  replies: [buttons(msg.saleFailed, [{ id: 'retry:sale', title: msg.retry }])],
});

async function submitSale(state: OrderState, tools: FlowTools): Promise<StepResult> {
  const order = buildOrder(state);
  if (!order) return nextStep(state, tools);
  const attempt: OrderState = {
    ...state,
    step: 'creatingSale',
    saleAttemptAt: state.saleAttemptAt ?? tools.now().toISOString(),
  };
  await tools.checkpoint(attempt);
  try {
    const id = await tools.createSale(order);
    return { state: null, replies: [text(msg.saleCreated(id))] };
  } catch (error) {
    if (error instanceof ToolError) {
      if (error.cause instanceof SaleRejectedError) {
        return { state: null, replies: [text(msg.saleRejected(tools.storePhone))] };
      }
      return saleFailed(attempt, tools);
    }
    throw error;
  }
}

const handleSummary: HandleFn = async (state, input, tools) => {
  const choice = choiceOf(input, 'summary');
  if (choice === 'confirm') return submitSale(state, tools);
  if (choice === 'fix') return chooseCorrection(state, tools);
  return summary(state, tools);
};

const handleChooseCorrection: HandleFn = async (state, input, tools) => {
  const choice = choiceOf(input, 'fix');
  if (choice === 'product') {
    const { product: _product, quantity: _quantity, quote: _quote, ...rest } = state;
    return nextStep(rest, tools);
  }
  if (choice === 'address') {
    const { address: _address, ...rest } = state;
    return nextStep(rest, tools);
  }
  if (choice === 'payment') {
    const { payment: _payment, quote: _quote, changeFor: _changeFor, ...rest } = state;
    return nextStep(rest, tools);
  }
  return chooseCorrection(state, tools);
};

const handleCreatingSale: HandleFn = async (state, _input, tools) => {
  const attemptAt = state.saleAttemptAt ? new Date(state.saleAttemptAt).getTime() : 0;
  if (tools.now().getTime() - attemptAt < STALE_ATTEMPT_MS) {
    return { state, replies: [text(msg.saleInProgress)] };
  }
  return saleFailed(state, tools);
};

export async function cancelAfterFailedSale(
  state: OrderState,
  tools: FlowTools,
): Promise<StepResult> {
  const order = buildOrder(state);
  if (order) {
    const since = new Date(state.saleAttemptAt ?? tools.now().toISOString());
    const existing = await tools.findRecentSale(order, since);
    if (existing !== null) return { state: null, replies: [text(msg.saleCreated(existing))] };
  }
  return { state: null, replies: [text(msg.cancelled)] };
}

const handleSaleFailed: HandleFn = async (state, input, tools) => {
  if (choiceOf(input, 'retry') !== 'sale') return saleFailed(state, tools);
  const order = buildOrder(state);
  if (!order) return nextStep(state, tools);
  const since = new Date(state.saleAttemptAt ?? tools.now().toISOString());
  const existing = await tools.findRecentSale(order, since);
  if (existing !== null) return { state: null, replies: [text(msg.saleCreated(existing))] };
  return submitSale(state, tools);
};

export const asks: Partial<Record<Step, AskFn>> = {
  summary,
  chooseCorrection,
  creatingSale,
  saleFailed,
};

export const handlers: Partial<Record<Step, HandleFn>> = {
  summary: handleSummary,
  chooseCorrection: handleChooseCorrection,
  creatingSale: handleCreatingSale,
  saleFailed: handleSaleFailed,
};
