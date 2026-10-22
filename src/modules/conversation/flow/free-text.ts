import type {
  Interpretation,
  InterpretContext,
} from 'src/modules/assistant/contracts/assistant.types';
import type { PaymentOption, Product } from 'src/modules/catalog/contracts/catalog.types';
import { normalizeText } from 'src/utils/text';
import type { Reply } from '../contracts/conversation.types';
import type { FlowTools, OrderState, Step, StepResult } from './flow.types';
import { msg } from './messages';
import { nextStep } from './next-step';
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
const IDENTIFICATION_STEPS: Step[] = ['askName', 'askCpf', 'askMissingCpf'];
const OTHER_ADDRESS_NOTE = 'entrega em outro endereço';

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
  return !NUMERIC_ONLY.test(text) && hasOrderWord(text);
}

function matchProducts(names: string[] | undefined, products: Product[]): Product[] {
  const matched: Product[] = [];
  for (const name of names ?? []) {
    const wanted = normalizeText(name);
    const product = products.find(item => normalizeText(item.name) === wanted);
    if (product && !matched.some(item => item.id === product.id)) matched.push(product);
  }
  return matched;
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
): { state: OrderState; notes: string[] } | null {
  const next: OrderState = { ...state };
  const notes: string[] = [];
  let changed = false;

  const matched = matchProducts(result.products, catalog.products);
  const quantity =
    Number.isInteger(result.quantity) && (result.quantity ?? 0) >= 1 ? result.quantity : undefined;

  if (matched.length > 0) {
    changed = true;
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
    next.quantity = quantity;
    delete next.quote;
  }

  if (next.product && matched.length <= 1) {
    if (quantity !== undefined) notes.push(`${quantity}x ${next.product.name}`);
    else if (matched.length === 1) notes.push(next.product.name);
  }

  const payment = matchPayment(result.payment, catalog.payments);
  if (payment) {
    changed = true;
    next.payment = payment;
    delete next.quote;
    delete next.changeFor;
    notes.push(payment.label);
  }

  const addressText = result.address?.trim();
  if (addressText || result.newAddress) {
    changed = true;
    delete next.address;
    delete next.draftAddress;
    delete next.missingField;
    if (addressText) next.pendingAddressText = addressText;
    else delete next.pendingAddressText;
    notes.push(OTHER_ADDRESS_NOTE);
  }

  return changed ? { state: next, notes } : null;
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

export async function seedFromText(raw: string, tools: FlowTools): Promise<Seed> {
  const empty: Seed = { fields: {}, replies: [] };
  const catalog: Catalog = {
    products: await tools.listProducts({}),
    payments: await tools.listPaymentOptions(),
  };
  const result = await tools.interpret(raw, contextOf(catalog));
  if (!result || result.confidence < MIN_CONFIDENCE) return empty;

  const applied = applyInterpretation({ step: 'askName', customer: {} }, result, catalog);
  if (!applied) {
    if (result.intent !== 'question') return empty;
    return { fields: {}, replies: [text(msg.offTopic(tools.storePhone))] };
  }

  const { product, quantity, payment, productCandidates, pendingAddressText } = applied.state;
  const fields: Partial<OrderState> = {};
  if (product) fields.product = product;
  if (quantity !== undefined) fields.quantity = quantity;
  if (payment) fields.payment = payment;
  if (productCandidates) fields.productCandidates = productCandidates;
  if (pendingAddressText) fields.pendingAddressText = pendingAddressText;
  const replies = applied.notes.length > 0 ? [text(msg.noted(applied.notes))] : [];
  return { fields, replies };
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

export async function freeText(
  state: OrderState,
  raw: string,
  tools: FlowTools,
): Promise<StepResult> {
  const catalog = await loadCatalog(state, tools);
  const result = await tools.interpret(raw, contextOf(catalog));
  if (!result || result.confidence < MIN_CONFIDENCE) {
    return repeatQuestion(state, tools, text(msg.notUnderstood));
  }

  const applied = applyInterpretation(state, result, catalog);
  if (!applied) {
    const first = result.intent === 'question' ? msg.offTopic(tools.storePhone) : msg.notUnderstood;
    return repeatQuestion(state, tools, text(first));
  }

  const noted = applied.notes.length > 0 ? [text(msg.noted(applied.notes))] : [];
  const ask = asks[state.step];
  const next =
    IDENTIFICATION_STEPS.includes(state.step) && ask
      ? await ask(applied.state, tools)
      : await nextStep(applied.state, tools);
  return { ...next, replies: [...noted, ...next.replies] };
}

export function freeTextOr(
  state: OrderState,
  raw: string | null,
  tools: FlowTools,
  fallback: string,
): Promise<StepResult> {
  if (raw !== null && shouldInterpret(raw)) return freeText(state, raw, tools);
  return Promise.resolve({ state, replies: [text(fallback)] });
}
