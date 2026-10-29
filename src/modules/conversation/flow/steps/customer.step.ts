import { isValidCpf, onlyDigits } from 'src/utils/cpf';
import {
  type AskFn,
  type FlowInput,
  type FlowTools,
  type HandleFn,
  MAX_CPF_ATTEMPTS,
  type OrderState,
  type Step,
  type StepResult,
} from '../flow.types';
import { freeText, freeTextOr, keepOfferedProduct, looksLikeOrder } from '../free-text';
import { textOf } from '../input';
import { msg } from '../messages';
import { nextStep } from '../next-step';
import { text } from '../replies';
import { offerOrNext } from './repeat.step';

const MAX_NAME_LENGTH = 100;

function parseName(raw: string | null): string | null {
  if (raw === null) return null;
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const name = words.join(' ');
  if (words.length < 2 || name.length > MAX_NAME_LENGTH) return null;
  return words.every(word => /\p{L}/u.test(word)) ? name : null;
}

async function withHistory(
  state: OrderState,
  customerId: number,
  tools: FlowTools,
): Promise<OrderState> {
  const history = await tools.customerHistory(customerId);
  const loaded: OrderState = {
    ...state,
    addresses: history.addresses,
    boughtProductIds: history.productIds,
  };
  return history.lastOrder ? { ...loaded, lastOrder: history.lastOrder } : loaded;
}

export async function welcomeKnown(state: OrderState, tools: FlowTools): Promise<StepResult> {
  const { id, name } = state.customer;
  if (id === undefined || name === undefined) return nextStep(state, tools);
  const loaded = await withHistory(state, id, tools);
  const next = await offerOrNext(await keepOfferedProduct(loaded, tools), tools);
  return { state: next.state, replies: [text(msg.welcomeBack(name)), ...next.replies] };
}

function contactStore(tools: FlowTools): StepResult {
  return { state: null, replies: [text(msg.identityContactStore(tools.storePhone))] };
}

export async function start(
  input: FlowInput,
  tools: FlowTools,
  seed: Partial<OrderState> = {},
): Promise<StepResult> {
  const customer = await tools.findCustomer(input.phone);
  if (!customer) {
    return {
      state: { step: 'askName', customer: {}, ...seed },
      replies: [text(msg.welcomeNew)],
    };
  }

  if (!customer.cpf) return contactStore(tools);
  if (await tools.isBlocked(input.phone)) return contactStore(tools);

  const state: OrderState = {
    step: 'askCpfPrefix',
    customer: { id: customer.id, name: customer.name, cpf: customer.cpf, tagId: customer.tagId },
    ...seed,
  };
  if (await tools.isVerified(input.phone, customer.id)) return welcomeKnown(state, tools);
  return { state, replies: [text(msg.askCpfPrefix)] };
}

const askName: AskFn = async state => ({
  state: { ...state, step: 'askName' },
  replies: [text(msg.askName)],
});

const askCpf: AskFn = async state => ({
  state: { ...state, step: 'askCpf' },
  replies: [text(msg.askCpf)],
});

const askCpfPrefix: AskFn = async state => ({
  state: { ...state, step: 'askCpfPrefix' },
  replies: [text(msg.askCpfPrefix)],
});

const handleAskName: HandleFn = async (state, input, tools) => {
  const raw = textOf(input);
  const name = parseName(raw);
  const acceptName = (valid: string) =>
    askCpf({ ...state, customer: { ...state.customer, name: valid } }, tools);
  if (raw !== null && looksLikeOrder(raw)) {
    return freeText(state, raw, tools, name ? () => acceptName(name) : undefined);
  }
  if (!name) return { state, replies: [text(msg.invalidName)] };
  return acceptName(name);
};

const handleAskCpf: HandleFn = async (state, input, tools) => {
  const raw = textOf(input);
  if (raw === null || !isValidCpf(raw)) return freeTextOr(state, raw, tools, msg.invalidCpf);
  return nextStep({ ...state, customer: { ...state.customer, cpf: onlyDigits(raw) } }, tools);
};

const CPF_PREFIX_LENGTH = 3;
const STANDALONE_PREFIX = /\b\d{3}\b/g;
const NUMERIC_ONLY = /^[\d\s.-]+$/;

function prefixAttempt(raw: string | null): string | null {
  if (raw === null || !NUMERIC_ONLY.test(raw)) return null;
  const digits = onlyDigits(raw);
  return digits.length === CPF_PREFIX_LENGTH ? digits : null;
}

const handleAskCpfPrefix: HandleFn = async (state, input, tools) => {
  const { id, cpf } = state.customer;
  if (id === undefined || !cpf) return contactStore(tools);
  const raw = textOf(input);
  const digits = prefixAttempt(raw);
  if (digits === null) {
    const rest = raw?.replace(STANDALONE_PREFIX, '').trim() ?? '';
    if (!rest) return { state, replies: [text(msg.cpfPrefixFormat)] };
    return freeTextOr(state, rest, tools, msg.cpfPrefixFormat);
  }
  if (digits === cpf.slice(0, CPF_PREFIX_LENGTH)) {
    await tools.markVerified(input.phone, id);
    return welcomeKnown(state, tools);
  }
  const attempts = await tools.registerCpfMismatch(input.phone);
  if (attempts >= MAX_CPF_ATTEMPTS) return contactStore(tools);
  return { state, replies: [text(msg.cpfPrefixMismatch)] };
};

export const asks: Partial<Record<Step, AskFn>> = { askName, askCpf, askCpfPrefix };

export const handlers: Partial<Record<Step, HandleFn>> = {
  askName: handleAskName,
  askCpf: handleAskCpf,
  askCpfPrefix: handleAskCpfPrefix,
};
