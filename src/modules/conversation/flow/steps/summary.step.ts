import type { HandoffOrderSummary } from 'src/modules/handoff/contracts/handoff.types';
import {
  SaleAlreadyRegisteredError,
  type SaleAttemptStatus,
  SaleAttemptStoreError,
  type SaleOrder,
  SaleRejectedError,
  SaleUncertainError,
} from 'src/modules/order/contracts/order.types';
import { formatMoney } from 'src/utils/money';
import { customerSegmentOf } from '../customer-segment';
import {
  type AskFn,
  type FlowTools,
  type HandleFn,
  type OrderState,
  type Step,
  type StepResult,
  ToolError,
} from '../flow.types';
import { freeText } from '../free-text';
import { handoffButton, handoffSummary } from '../handoff';
import { choiceOf, textOf } from '../input';
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

function saleCreated(id: number, total: number, tools: FlowTools) {
  return text(tools.demo ? msg.demoSaleCreated(id, total) : msg.saleCreated(id, total));
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
  replies: [buttons(msg.saleFailed, [{ id: 'retry:sale', title: msg.retry }, handoffButton()])],
});

function uncertainSummary(state: OrderState): HandoffOrderSummary | null {
  const summary = handoffSummary(state);
  if (!summary) return null;
  const { customerName: _customerName, address: _address, ...rest } = summary;
  return rest;
}

async function saleUncertain(state: OrderState, tools: FlowTools): Promise<StepResult> {
  const creating: OrderState = { ...state, step: 'creatingSale' };
  const outcome = await tools.requestHandoff({
    phone: tools.phone,
    reason: 'sale_uncertain',
    summary: uncertainSummary(creating),
  });
  const replies = [text(msg.saleUncertain)];
  if (outcome.status === 'unavailable') replies.push(text(msg.talkToStore(tools.storePhone)));
  if (outcome.status === 'queued' && !outcome.open) {
    replies.push(text(msg.handoffClosed(outcome.nextOpening)));
  }
  return { state: creating, replies };
}

async function readAttempt(tools: FlowTools): Promise<SaleAttemptStatus | null | 'unreadable'> {
  try {
    return await tools.saleAttemptStatus();
  } catch (error) {
    if (error instanceof ToolError) return 'unreadable';
    throw error;
  }
}

function isStale(state: OrderState, tools: FlowTools): boolean {
  const attemptAt = state.saleAttemptAt ? new Date(state.saleAttemptAt).getTime() : 0;
  return tools.now().getTime() - attemptAt >= STALE_ATTEMPT_MS;
}

async function fromAttempt(
  status: SaleAttemptStatus | null | 'unreadable',
  state: OrderState,
  tools: FlowTools,
): Promise<StepResult> {
  if (status === 'pending' && !isStale(state, tools)) {
    return { state: { ...state, step: 'creatingSale' }, replies: [text(msg.saleInProgress)] };
  }
  if (status === 'registered') return submitSale(state, tools);
  if (status === 'rejected') {
    return { state: null, replies: [text(msg.saleRejected(tools.storePhone))] };
  }
  if (status === 'failed' || status === null) return saleFailed(state, tools);
  return saleUncertain(state, tools);
}

export async function checkSaleAttempt(state: OrderState, tools: FlowTools): Promise<StepResult> {
  return fromAttempt(await readAttempt(tools), state, tools);
}

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
    const id = await tools.createSale(order, { segment: customerSegmentOf(state) });
    return { state: null, replies: [saleCreated(id, order.total, tools)], saleId: id };
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    const cause = error.cause;
    if (cause instanceof SaleRejectedError) {
      return { state: null, replies: [text(msg.saleRejected(tools.storePhone))] };
    }
    if (cause instanceof SaleAttemptStoreError) {
      return { state: { ...state, step: 'summary' }, replies: [text(msg.saleStoreUnavailable)] };
    }
    if (cause instanceof SaleAlreadyRegisteredError) {
      return {
        state: null,
        replies: [saleCreated(cause.saleId, order.total, tools)],
        saleId: cause.saleId,
      };
    }
    if (cause instanceof SaleUncertainError) return saleUncertain(attempt, tools);
    if ((await readAttempt(tools)) === 'failed') return saleFailed(attempt, tools);
    return saleUncertain(attempt, tools);
  }
}

const handleSummary: HandleFn = async (state, input, tools) => {
  const choice = choiceOf(input, 'summary');
  if (choice === 'confirm') return submitSale(state, tools);
  if (choice === 'fix') return chooseCorrection(state, tools);
  const raw = textOf(input);
  if (raw !== null) return freeText(state, raw, tools);
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
  const raw = textOf(input);
  if (raw !== null) return freeText(state, raw, tools);
  return chooseCorrection(state, tools);
};

const handleCreatingSale: HandleFn = async (state, _input, tools) => checkSaleAttempt(state, tools);

export async function cancelAfterFailedSale(
  state: OrderState,
  tools: FlowTools,
): Promise<StepResult> {
  const order = buildOrder(state);
  if (order) {
    const since = new Date(state.saleAttemptAt ?? tools.now().toISOString());
    const existing = await tools.findRecentSale(order, since);
    if (existing !== null)
      return {
        state: null,
        replies: [saleCreated(existing, order.total, tools)],
        saleId: existing,
      };
  }
  tools.track({ name: 'order_cancelled' });
  return { state: null, replies: [text(msg.cancelled)] };
}

const handleSaleFailed: HandleFn = async (state, input, tools) => {
  if (choiceOf(input, 'retry') !== 'sale') return saleFailed(state, tools);
  const order = buildOrder(state);
  if (!order) return nextStep(state, tools);
  const status = await readAttempt(tools);
  if (status !== 'failed' && status !== null) return fromAttempt(status, state, tools);
  const since = new Date(state.saleAttemptAt ?? tools.now().toISOString());
  const existing = await tools.findRecentSale(order, since);
  if (existing !== null)
    return {
      state: null,
      replies: [saleCreated(existing, order.total, tools)],
      saleId: existing,
    };
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
