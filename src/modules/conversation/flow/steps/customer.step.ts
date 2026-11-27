import { isValidCpf, onlyDigits, removeLongDigitRuns } from 'src/utils/cpf';
import { normalizeText } from 'src/utils/text';
import {
  type AskFn,
  type FlowInput,
  type FlowTools,
  type HandleFn,
  type OrderState,
  type Step,
  type StepResult,
} from '../flow.types';
import {
  fixedQuestion,
  freeText,
  freeTextOr,
  keepOfferedProduct,
  looksLikeOrder,
} from '../free-text';
import { checkCpf, resolveIdentity } from '../identity';
import { textOf } from '../input';
import { msg } from '../messages';
import { nextStep } from '../next-step';
import { answerOrderStatus } from '../order-status';
import { text } from '../replies';
import { offerOrNext } from './repeat.step';

const MAX_NAME_LENGTH = 100;
const MAX_NAME_TEXT = 200;
const CPF_LIKE_DIGITS = 9;

function hasCpfLikeDigits(raw: string): boolean {
  return removeLongDigitRuns(raw, CPF_LIKE_DIGITS) !== raw;
}

function parseName(raw: string | null): string | null {
  if (raw === null) return null;
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const name = words.join(' ');
  if (words.length < 2 || name.length > MAX_NAME_LENGTH) return null;
  return words.every(word => /\p{L}/u.test(word)) ? name : null;
}

function wordsOf(value: string): string[] {
  return normalizeText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function writtenIn(name: string, raw: string): boolean {
  const said = new Set(wordsOf(raw));
  return wordsOf(name).every(word => said.has(word));
}

async function nameFromText(raw: string, tools: FlowTools): Promise<string | null> {
  if (raw.trim().length > MAX_NAME_TEXT) return null;
  const reading = await tools.readName(raw);
  if (reading === null) return parseName(raw);
  if (!reading.isPersonName || reading.name === null) return null;
  const name = parseName(reading.name);
  return name && writtenIn(name, raw) ? name : null;
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

function greeting(message: string, tools: FlowTools): string {
  return tools.demo ? msg.demoGreeting(message) : message;
}

export async function welcomeKnown(state: OrderState, tools: FlowTools): Promise<StepResult> {
  const { id, name } = state.customer;
  if (id === undefined || name === undefined) return nextStep(state, tools);
  const loaded = await withHistory(state, id, tools);
  const next = await offerOrNext(await keepOfferedProduct(loaded, tools), tools);
  return {
    state: next.state,
    replies: [text(greeting(msg.welcomeBack(name), tools)), ...next.replies],
  };
}

function contactStore(tools: FlowTools): StepResult {
  return { state: null, replies: [text(msg.identityContactStore(tools.storePhone))] };
}

function askIdentity(state: OrderState): StepResult {
  return { state: { ...state, step: 'confirmCpf', customer: {} }, replies: [text(msg.askFullCpf)] };
}

export async function start(
  input: FlowInput,
  tools: FlowTools,
  seed: Partial<OrderState> = {},
): Promise<StepResult> {
  const identity = await resolveIdentity(input.phone, tools);
  switch (identity.kind) {
    case 'new':
      return {
        state: { step: 'askName', customer: {}, ...seed },
        replies: [text(greeting(msg.welcomeNew, tools))],
      };
    case 'handoff':
      return contactStore(tools);
    case 'verified':
      return welcomeKnown({ step: 'confirmCpf', ...seed, customer: identity.customer }, tools);
    case 'ask':
      return askIdentity({ step: 'confirmCpf', customer: {}, ...seed });
  }
}

const askName: AskFn = async state => ({
  state: { ...state, step: 'askName' },
  replies: [text(msg.askName)],
});

const askCpf: AskFn = async state => ({
  state: { ...state, step: 'askCpf' },
  replies: [text(msg.askCpf)],
});

const confirmCpf: AskFn = async state => askIdentity(state);

const handleAskName: HandleFn = async (state, input, tools) => {
  const raw = textOf(input);
  const name = parseName(raw);
  const acceptName = (valid: string) =>
    askCpf({ ...state, customer: { ...state.customer, name: valid } }, tools);
  if (raw !== null && (looksLikeOrder(raw) || raw.includes('?') || fixedQuestion(raw))) {
    return freeText(state, raw, tools, {
      whenNothingApplied: name ? () => acceptName(name) : undefined,
    });
  }
  const read = raw === null || !raw.trim() ? null : await nameFromText(raw, tools);
  if (!read) return { state, replies: [text(msg.invalidName)] };
  return acceptName(read);
};

const handleAskCpf: HandleFn = async (state, input, tools) => {
  const raw = textOf(input);
  if (raw === null || !isValidCpf(raw)) {
    if (raw !== null && hasCpfLikeDigits(raw)) return { state, replies: [text(msg.invalidCpf)] };
    return freeTextOr(state, raw, tools, msg.invalidCpf);
  }
  return nextStep({ ...state, customer: { ...state.customer, cpf: onlyDigits(raw) } }, tools);
};

const handleConfirmCpf: HandleFn = async (state, input, tools) => {
  const raw = textOf(input);
  if (raw === null || !isValidCpf(raw)) {
    if (raw !== null && hasCpfLikeDigits(raw)) return { state, replies: [text(msg.invalidCpf)] };
    return freeTextOr(state, raw, tools, msg.askFullCpf);
  }
  const result = await checkCpf(input.phone, raw, tools);
  switch (result.kind) {
    case 'verified':
      if (state.pendingOrderStatus) return answerOrderStatus(state, result.customer.id, tools);
      return welcomeKnown({ ...state, customer: result.customer }, tools);
    case 'mismatch':
      return { state, replies: [text(msg.cpfMismatch)] };
    case 'invalid':
      return { state, replies: [text(msg.invalidCpf)] };
    case 'new':
    case 'ask':
    case 'handoff':
      return contactStore(tools);
  }
};

const handleAskCpfPrefix: HandleFn = async (_state, input, tools) => start(input, tools);

export const asks: Partial<Record<Step, AskFn>> = {
  askName,
  askCpf,
  askCpfPrefix: confirmCpf,
  confirmCpf,
};

export const handlers: Partial<Record<Step, HandleFn>> = {
  askName: handleAskName,
  askCpf: handleAskCpf,
  askCpfPrefix: handleAskCpfPrefix,
  confirmCpf: handleConfirmCpf,
};
