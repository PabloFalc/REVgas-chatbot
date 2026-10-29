import { normalizeText } from 'src/utils/text';
import {
  type AskFn,
  type FlowTools,
  type HandleFn,
  type OrderState,
  type RepeatOffer,
  type Step,
  type StepResult,
  ToolError,
} from '../flow.types';
import { freeText } from '../free-text';
import { choiceOf, textOf } from '../input';
import { msg } from '../messages';
import { nextStep } from '../next-step';
import { buttons } from '../replies';

const ORDER_FIELDS = [
  'product',
  'productCandidates',
  'quantity',
  'payment',
  'address',
  'draftAddress',
  'pendingAddressText',
] as const;

const TYPED_CHOICES = new Map([
  ['sim', 'yes'],
  ['repetir', 'yes'],
  ['novo', 'new'],
  ['novo pedido', 'new'],
  ['nao', 'new'],
]);

function typedChoice(raw: string | null): string | null {
  return raw === null ? null : (TYPED_CHOICES.get(normalizeText(raw)) ?? null);
}

async function findOffer(state: OrderState, tools: FlowTools): Promise<RepeatOffer | null> {
  const last = state.lastOrder;
  if (!last) return null;
  const customer = { id: state.customer.id, tagId: state.customer.tagId };
  const products = await tools.listProducts(customer);
  const product = products.find(item => item.id === last.productId);
  if (!product) return null;
  const payments = await tools.listPaymentOptions();
  const payment = payments.find(item => item.type === last.paymentType);
  if (!payment) return null;
  const quote = await tools.quote(customer, product.id, payment.type, last.quantity);
  if (!quote) return null;
  return { product, quantity: last.quantity, payment, address: last.address, quote };
}

async function safeOffer(state: OrderState, tools: FlowTools): Promise<RepeatOffer | null> {
  try {
    return await findOffer(state, tools);
  } catch (error) {
    if (error instanceof ToolError) return null;
    throw error;
  }
}

export async function offerOrNext(state: OrderState, tools: FlowTools): Promise<StepResult> {
  if (!state.lastOrder || ORDER_FIELDS.some(field => state[field] !== undefined)) {
    return nextStep(state, tools);
  }
  const repeatOffer = await safeOffer(state, tools);
  if (!repeatOffer) return nextStep(state, tools);
  return offerRepeat({ ...state, repeatOffer }, tools);
}

const offerRepeat: AskFn = async (state, tools) => {
  if (!state.repeatOffer) return nextStep(state, tools);
  return {
    state: { ...state, step: 'offerRepeat' },
    replies: [
      buttons(msg.offerRepeat(state.repeatOffer), [
        { id: 'repeat:yes', title: msg.repeatOrder },
        { id: 'repeat:new', title: msg.newOrder },
      ]),
    ],
  };
};

const handleOfferRepeat: HandleFn = async (state, input, tools) => {
  const raw = textOf(input);
  const choice = choiceOf(input, 'repeat') ?? typedChoice(raw);
  const { repeatOffer, ...rest } = state;
  if (choice === 'yes' && repeatOffer) {
    const { product, quantity, payment, address, quote } = repeatOffer;
    return nextStep({ ...rest, address, product, quantity, payment, quote }, tools);
  }
  if (choice === 'new') return nextStep(rest, tools);
  if (raw !== null) return freeText(state, raw, tools);
  return offerRepeat(state, tools);
};

export const asks: Partial<Record<Step, AskFn>> = { offerRepeat };

export const handlers: Partial<Record<Step, HandleFn>> = { offerRepeat: handleOfferRepeat };
