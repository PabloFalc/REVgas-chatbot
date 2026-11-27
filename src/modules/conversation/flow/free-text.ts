import type {
  Interpretation,
  InterpretContext,
} from 'src/modules/assistant/contracts/assistant.types';
import type { PaymentOption, Product } from 'src/modules/catalog/contracts/catalog.types';
import type { CommercialField } from 'src/modules/metrics/contracts/metrics.types';
import { removeCpfMentions, removeLongDigitRuns } from 'src/utils/cpf';
import { normalizeText } from 'src/utils/text';
import type { Reply } from '../contracts/conversation.types';
import { isCapabilitiesQuestion } from './capabilities';
import {
  CPF_STEPS,
  type FlowTools,
  type OrderState,
  type Step,
  type StepResult,
} from './flow.types';
import { offer } from './handoff';
import { cleanItem, matchProducts, routeIntent } from './intent';
import { msg } from './messages';
import { nextStep } from './next-step';
import { isQuestionInvite } from './question-invite';
import { repeatQuestion } from './repeat-question';
import { text } from './replies';
import { asks } from './steps/registry';

export const MIN_CONFIDENCE = 0.6;

const ORDER_WORDS = new Set([
  'quero',
  'queria',
  'manda',
  'mande',
  'pedir',
  'pedido',
  'botijao',
  'botijoes',
  'gas',
  'agua',
  'pix',
  'cartao',
  'credito',
  'debito',
  'dinheiro',
  'entrega',
  'entregar',
  'endereco',
  'casa',
  'rua',
]);

const NUMERIC_ONLY = /^[\d\s.,\-/R$]*$/i;
const LETTERS = /\p{L}{2,}/u;
const GREETING_ONLY = /^(?:(?:oi|ola|bom dia|boa tarde|boa noite|opa|eai|e ai|menu)(?:\s+|$))+$/;
const CPF_STEP_DIGITS = 3;
export const STUCK_AFTER = 3;
const IDENTIFICATION_STEPS: Step[] = ['askName', 'askCpf', 'askCpfPrefix'];
const MONEY_STEPS: Step[] = ['askChangeAmount'];
const OTHER_ADDRESS_NOTE = 'entrega em outro endereço';
const INVITE: Interpretation = { intent: 'question', topic: 'invite', confidence: 1 };
const CAPABILITIES: Interpretation = { intent: 'question', topic: 'capabilities', confidence: 1 };

export function fixedQuestion(text: string): Interpretation | null {
  if (isQuestionInvite(text)) return INVITE;
  if (isCapabilitiesQuestion(text)) return CAPABILITIES;
  return null;
}

export interface Catalog {
  products: Product[];
  payments: PaymentOption[];
}

function hasOrderWord(text: string): boolean {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .some(word => ORDER_WORDS.has(word));
}

export function looksLikeOrder(text: string): boolean {
  return /\d/.test(text) || hasOrderWord(text);
}

export function shouldInterpret(text: string): boolean {
  return !NUMERIC_ONLY.test(text) && LETTERS.test(text);
}

export function isGreetingOnly(text: string): boolean {
  const words = normalizeText(text)
    .replace(/[^a-z]+/g, ' ')
    .trim();
  return GREETING_ONLY.test(words);
}

function spokenText(state: OrderState, raw: string): string {
  if (!CPF_STEPS.includes(state.step)) return raw;
  return removeLongDigitRuns(removeCpfMentions(raw), CPF_STEP_DIGITS).replace(/\s+/g, ' ').trim();
}

function matchPayment(value: string | undefined, payments: PaymentOption[]): PaymentOption | null {
  if (!value) return null;
  const wanted = normalizeText(value);
  return (
    payments.find(
      item => normalizeText(item.type) === wanted || normalizeText(item.label) === wanted,
    ) ?? null
  );
}

export function applyInterpretation(
  state: OrderState,
  result: Interpretation,
  catalog: Catalog,
): { state: OrderState; notes: string[]; changedFields: CommercialField[] } | null {
  const next: OrderState = { ...state };
  const notes: string[] = [];
  let changed = false;
  const changedFields: CommercialField[] = [];

  const matched = matchProducts(result.products, catalog.products);
  const quantity =
    Number.isInteger(result.quantity) && (result.quantity ?? 0) >= 1 ? result.quantity : undefined;

  let productChanged = false;
  const keepsCurrent = matched.some(item => item.id === state.product?.id);
  if (matched.length > 0 && !keepsCurrent) {
    productChanged = true;
    changed = true;
    changedFields.push('product');
    delete next.quote;
    if (quantity === undefined) delete next.quantity;
    if (matched.length === 1) {
      next.product = matched[0];
      delete next.productCandidates;
    } else {
      delete next.product;
      next.productCandidates = matched;
    }
  }

  if (quantity !== undefined) {
    changed = true;
    if (quantity !== state.quantity) changedFields.push('quantity');
    next.quantity = quantity;
    delete next.quote;
  }

  if (next.product) {
    if (quantity !== undefined) notes.push(`${quantity}x ${next.product.name}`);
    else if (productChanged) notes.push(next.product.name);
  }

  const payment = matchPayment(result.payment, catalog.payments);
  if (payment) {
    changed = true;
    if (payment.type !== state.payment?.type) changedFields.push('payment');
    next.payment = payment;
    delete next.quote;
    delete next.changeFor;
    notes.push(payment.label);
  }

  const addressText = result.address?.trim();
  if (addressText || result.newAddress) {
    changed = true;
    changedFields.push('address');
    delete next.address;
    delete next.draftAddress;
    delete next.missingField;
    if (addressText) next.pendingAddressText = addressText;
    else delete next.pendingAddressText;
    notes.push(OTHER_ADDRESS_NOTE);
  }

  return changed ? { state: next, notes, changedFields } : null;
}

async function loadCatalog(state: OrderState, tools: FlowTools): Promise<Catalog> {
  const products =
    state.productOptions ??
    (await tools.listProducts({ id: state.customer.id, tagId: state.customer.tagId }));
  const payments = state.paymentOptions ?? (await tools.listPaymentOptions());
  return { products, payments };
}

function contextOf(catalog: Catalog): InterpretContext {
  return {
    products: catalog.products.map(product => product.name),
    payments: catalog.payments.map(({ type, label }) => ({ type, label })),
  };
}

export interface Seed {
  fields: Partial<OrderState>;
  replies: Reply[];
}

export type FirstMessage = { kind: 'routed'; result: StepResult } | { kind: 'seed'; seed: Seed };

const EMPTY_SEED: Seed = { fields: {}, replies: [] };

function notCarriedNote(result: Interpretation, catalog: Catalog): string | null {
  const item = result.unknownProduct;
  if (!item || matchProducts([item], catalog.products).length > 0) return null;
  return msg.notCarried(cleanItem(item));
}

function notedReplies(result: Interpretation, catalog: Catalog, notes: string[]): Reply[] {
  const parts = [notCarriedNote(result, catalog), notes.length > 0 ? msg.noted(notes) : null];
  const body = parts.filter((part): part is string => part !== null).join(' ');
  return body ? [text(body)] : [];
}

export function seedFromInterpretation(result: Interpretation, catalog: Catalog): Seed {
  if (result.intent !== 'order') return EMPTY_SEED;
  const applied = applyInterpretation({ step: 'askName', customer: {} }, result, catalog);
  if (!applied) return EMPTY_SEED;

  const { product, quantity, payment, productCandidates, pendingAddressText } = applied.state;
  const fields: Partial<OrderState> = {};
  if (product) fields.product = product;
  if (quantity !== undefined) fields.quantity = quantity;
  if (payment) fields.payment = payment;
  if (productCandidates) fields.productCandidates = productCandidates;
  if (pendingAddressText) fields.pendingAddressText = pendingAddressText;
  return { fields, replies: notedReplies(result, catalog, applied.notes) };
}

export async function readFirstMessage(raw: string, tools: FlowTools): Promise<FirstMessage> {
  if (isGreetingOnly(raw) || !shouldInterpret(raw)) return { kind: 'seed', seed: EMPTY_SEED };
  const fixed = fixedQuestion(raw);
  if (fixed) {
    const answered = await routeIntent(null, fixed, raw, tools);
    if (answered) return { kind: 'routed', result: answered };
  }
  const catalog: Catalog = {
    products: await tools.listProducts({}),
    payments: await tools.listPaymentOptions(),
  };
  const result = await tools.interpret(raw, contextOf(catalog));
  if (!result || result.confidence < MIN_CONFIDENCE) return { kind: 'seed', seed: EMPTY_SEED };
  const routed = await routeIntent(null, result, raw, tools);
  if (routed) return { kind: 'routed', result: routed };
  return { kind: 'seed', seed: seedFromInterpretation(result, catalog) };
}

export async function keepOfferedProduct(state: OrderState, tools: FlowTools): Promise<OrderState> {
  if (!state.product && !state.productCandidates) return state;
  const offered = await tools.listProducts({ id: state.customer.id, tagId: state.customer.tagId });
  const ids = new Set(offered.map(item => item.id));
  const next: OrderState = { ...state };

  if (next.product && !ids.has(next.product.id)) {
    delete next.product;
    delete next.quantity;
    delete next.quote;
  }
  if (next.productCandidates) {
    const left = next.productCandidates.filter(item => ids.has(item.id));
    if (left.length === 1 && !next.product) {
      next.product = left[0];
      delete next.productCandidates;
    } else if (left.length > 1) {
      next.productCandidates = left;
    } else {
      delete next.productCandidates;
    }
  }
  return next;
}

export interface FreeTextOptions {
  whenNothingApplied?: () => Promise<StepResult>;
  fallback?: string;
}

async function misunderstood(
  state: OrderState,
  tools: FlowTools,
  fallback?: string,
): Promise<StepResult> {
  const count = await tools.registerMisunderstood();
  if (count < STUCK_AFTER && fallback !== undefined) {
    return { state, replies: [text(fallback)], misunderstood: true };
  }
  const first = count >= STUCK_AFTER ? offer(msg.stuck) : text(msg.notUnderstood);
  const result = await repeatQuestion(state, tools, first);
  return { ...result, misunderstood: true };
}

function readingFor(state: OrderState, result: Interpretation): Interpretation {
  if (!MONEY_STEPS.includes(state.step)) return result;
  const { quantity: _quantity, ...rest } = result;
  return rest;
}

export async function freeText(
  state: OrderState,
  raw: string,
  tools: FlowTools,
  options: FreeTextOptions = {},
): Promise<StepResult> {
  const { whenNothingApplied, fallback } = options;
  const spoken = spokenText(state, raw);
  const fixed = fixedQuestion(spoken);
  if (fixed) {
    const answered = await routeIntent(state, fixed, spoken, tools);
    if (answered) return answered;
  }
  const catalog = await loadCatalog(state, tools);
  const interpreted = await tools.interpret(spoken, contextOf(catalog));
  if (!interpreted || interpreted.confidence < MIN_CONFIDENCE) {
    return misunderstood(state, tools, fallback);
  }
  const result = readingFor(state, interpreted);

  if (result.intent === 'other' && whenNothingApplied) return whenNothingApplied();
  const routed = await routeIntent(state, result, spoken, tools);
  if (routed) return routed;

  const applied = result.intent === 'order' ? applyInterpretation(state, result, catalog) : null;
  if (!applied) return misunderstood(state, tools, fallback);

  const revised = state.revision !== undefined && applied.changedFields.length > 0;
  const toNext: OrderState = revised
    ? { ...applied.state, revision: (state.revision ?? 1) + 1 }
    : applied.state;
  if (revised) tools.track({ name: 'summary_changed', fields: applied.changedFields });

  const ask = asks[state.step];
  const next =
    IDENTIFICATION_STEPS.includes(state.step) && ask
      ? await ask(toNext, tools)
      : await nextStep(toNext, tools);
  if (revised && next.state?.step === 'summary') {
    const noted = notedReplies(result, catalog, []);
    return { ...next, replies: [...noted, text(msg.summaryUpdated), ...next.replies] };
  }
  const noted = notedReplies(result, catalog, applied.notes);
  return { ...next, replies: [...noted, ...next.replies] };
}

export function freeTextOr(
  state: OrderState,
  raw: string | null,
  tools: FlowTools,
  fallback: string,
): Promise<StepResult> {
  if (raw !== null && shouldInterpret(raw)) return freeText(state, raw, tools, { fallback });
  return Promise.resolve({ state, replies: [text(fallback)] });
}
