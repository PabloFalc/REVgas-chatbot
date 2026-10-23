import type { AskFn, FlowTools, HandleFn, OrderState, Step, StepResult } from '../flow.types';
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

export async function offerOrNext(state: OrderState, tools: FlowTools): Promise<StepResult> {
  const last = state.lastOrder;
  if (!last || ORDER_FIELDS.some(field => state[field] !== undefined)) {
    return nextStep(state, tools);
  }
  const customer = { id: state.customer.id, tagId: state.customer.tagId };
  const products = await tools.listProducts(customer);
  const product = products.find(item => item.id === last.productId);
  if (!product) return nextStep(state, tools);
  const payments = await tools.listPaymentOptions();
  const payment = payments.find(item => item.type === last.paymentType);
  if (!payment) return nextStep(state, tools);
  const quote = await tools.quote(customer, product.id, payment.type, last.quantity);
  if (!quote) return nextStep(state, tools);
  const repeatOffer = { product, quantity: last.quantity, payment, address: last.address, quote };
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
  const choice = choiceOf(input, 'repeat');
  const { repeatOffer, ...rest } = state;
  if (choice === 'yes' && repeatOffer) {
    const { product, quantity, payment, address, quote } = repeatOffer;
    return nextStep({ ...rest, address, product, quantity, payment, quote }, tools);
  }
  if (choice === 'new') return nextStep(rest, tools);
  const raw = textOf(input);
  if (raw !== null) return freeText(state, raw, tools);
  return offerRepeat(state, tools);
};

export const asks: Partial<Record<Step, AskFn>> = { offerRepeat };

export const handlers: Partial<Record<Step, HandleFn>> = { offerRepeat: handleOfferRepeat };
