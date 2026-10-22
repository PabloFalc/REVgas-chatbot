import {
  CpfTakenError,
  CustomerRejectedError,
} from 'src/modules/customer/contracts/customer.types';
import { isValidCpf, onlyDigits } from 'src/utils/cpf';
import {
  type AskFn,
  type FlowInput,
  type FlowTools,
  type HandleFn,
  type OrderState,
  type Step,
  type StepResult,
  ToolError,
} from '../flow.types';
import { freeText, freeTextOr, looksLikeOrder } from '../free-text';
import { textOf } from '../input';
import { msg } from '../messages';
import { nextStep } from '../next-step';
import { text } from '../replies';

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
  return { ...state, addresses: history.addresses, boughtProductIds: history.productIds };
}

export async function start(input: FlowInput, tools: FlowTools): Promise<StepResult> {
  const customer = await tools.findCustomer(input.phone);
  if (!customer) {
    return { state: { step: 'askName', customer: {} }, replies: [text(msg.welcomeNew)] };
  }

  const welcome = text(msg.welcomeBack(customer.name));
  const base: OrderState = {
    step: 'askMissingCpf',
    customer: { id: customer.id, name: customer.name, tagId: customer.tagId },
  };

  if (!customer.cpf) {
    return { state: base, replies: [welcome, text(msg.askMissingCpf)] };
  }

  const known: OrderState = { ...base, customer: { ...base.customer, cpf: customer.cpf } };
  const loaded = await withHistory(known, customer.id, tools);
  const next = await nextStep(loaded, tools);
  return { state: next.state, replies: [welcome, ...next.replies] };
}

const askName: AskFn = async state => ({
  state: { ...state, step: 'askName' },
  replies: [text(msg.askName)],
});

const askCpf: AskFn = async state => ({
  state: { ...state, step: 'askCpf' },
  replies: [text(msg.askCpf)],
});

const askMissingCpf: AskFn = async state => ({
  state: { ...state, step: 'askMissingCpf' },
  replies: [text(msg.askMissingCpf)],
});

const handleAskName: HandleFn = async (state, input, tools) => {
  const raw = textOf(input);
  if (raw !== null && looksLikeOrder(raw)) return freeText(state, raw, tools);
  const name = parseName(raw);
  if (!name) return { state, replies: [text(msg.invalidName)] };
  return askCpf({ ...state, customer: { ...state.customer, name } }, tools);
};

const handleAskCpf: HandleFn = async (state, input, tools) => {
  const raw = textOf(input);
  if (raw === null || !isValidCpf(raw)) return freeTextOr(state, raw, tools, msg.invalidCpf);
  return nextStep({ ...state, customer: { ...state.customer, cpf: onlyDigits(raw) } }, tools);
};

const handleAskMissingCpf: HandleFn = async (state, input, tools) => {
  const raw = textOf(input);
  const customerId = state.customer.id;
  if (raw === null || !isValidCpf(raw) || customerId === undefined) {
    return freeTextOr(state, raw, tools, msg.invalidCpf);
  }
  const cpf = onlyDigits(raw);
  try {
    await tools.saveCpf(customerId, cpf);
  } catch (error) {
    const cause = error instanceof ToolError ? error.cause : error;
    if (cause instanceof CpfTakenError) {
      return { state: null, replies: [text(msg.cpfTaken(tools.storePhone))] };
    }
    if (cause instanceof CustomerRejectedError) {
      return { state, replies: [text(msg.invalidCpf)] };
    }
    throw error;
  }
  const loaded = await withHistory(
    { ...state, customer: { ...state.customer, cpf } },
    customerId,
    tools,
  );
  return nextStep(loaded, tools);
};

export const asks: Partial<Record<Step, AskFn>> = { askName, askCpf, askMissingCpf };

export const handlers: Partial<Record<Step, HandleFn>> = {
  askName: handleAskName,
  askCpf: handleAskCpf,
  askMissingCpf: handleAskMissingCpf,
};
