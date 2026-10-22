import type { Interpretation } from 'src/modules/assistant/contracts/assistant.types';
import type { PaymentOption, Product } from 'src/modules/catalog/contracts/catalog.types';
import { normalizeText } from 'src/utils/text';
import type { OrderState } from './flow.types';

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
