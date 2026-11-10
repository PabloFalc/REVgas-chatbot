import type { Interpretation } from 'src/modules/assistant/contracts/assistant.types';
import type { PriceCustomer, Product } from 'src/modules/catalog/contracts/catalog.types';
import { normalizeText } from 'src/utils/text';
import type { FlowTools, OrderState, StepResult } from './flow.types';
import { handoff, handoffButton, offer, orderStartButton, requestReasonFor } from './handoff';
import { msg } from './messages';
import { repeatQuestion } from './repeat-question';
import { BUTTONS_BODY_LIMIT, buttons, text } from './replies';

const ITEM_LIMIT = 30;

interface Answer {
  body: string;
  offer: boolean;
}

const plain = (body: string): Answer => ({ body, offer: false });
const offering = (body: string): Answer => ({ body, offer: true });

export function matchProducts(names: string[] | undefined, products: Product[]): Product[] {
  const matched: Product[] = [];
  for (const name of names ?? []) {
    const wanted = normalizeText(name);
    const product = products.find(item => normalizeText(item.name) === wanted);
    if (product && !matched.some(item => item.id === product.id)) matched.push(product);
  }
  return matched;
}

export function cleanItem(item: string): string | null {
  const clean = item
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ITEM_LIMIT)
    .trim();
  return clean || null;
}

function customerOf(state: OrderState | null): PriceCustomer {
  return state ? { id: state.customer.id, tagId: state.customer.tagId } : {};
}

async function question(result: Interpretation, raw: string, tools: FlowTools): Promise<Answer> {
  if (result.topic === 'hours') {
    const hours = await tools.serviceHours();
    if (hours.windows.length === 0) return offering(msg.noServiceHours);
    return plain(msg.serviceHours(hours.windows, hours.open));
  }
  if (result.topic === 'payments') {
    const options = await tools.listPaymentOptions();
    if (options.length === 0) return offering(msg.notKnown);
    return plain(msg.paymentsAccepted(options.map(option => option.label)));
  }
  const answer = await tools.answerQuestion(raw);
  return answer.kind === 'answered' ? plain(answer.text) : offering(msg.notKnown);
}

async function price(result: Interpretation, tools: FlowTools): Promise<Answer> {
  const prices = await tools.basePrices();
  if (prices.length === 0) return offering(msg.noPrice);
  const catalog = prices.map(item => item.product);
  const named = matchProducts(result.products, catalog);
  const shown =
    named.length > 0
      ? prices.filter(item => named.some(product => product.id === item.product.id))
      : prices;
  return plain(msg.prices(shown));
}

async function notSold(
  state: OrderState | null,
  result: Interpretation,
  tools: FlowTools,
): Promise<Answer | null> {
  if (!result.unknownProduct) return null;
  const products = await tools.listProducts(customerOf(state));
  if (matchProducts(result.products, products).length > 0) return null;
  const names = products.map(product => product.name);
  return plain(msg.notSold(cleanItem(result.unknownProduct), names));
}

async function answerFor(
  state: OrderState | null,
  result: Interpretation,
  raw: string,
  tools: FlowTools,
): Promise<Answer | null> {
  switch (result.intent) {
    case 'question':
      return question(result, raw, tools);
    case 'price':
      return price(result, tools);
    case 'off_topic':
      return plain(msg.offTopicRefusal);
    case 'offense':
      return (await tools.registerOffense()) >= 2 ? offering(msg.offense) : plain(msg.offense);
    case 'order':
      return notSold(state, result, tools);
    default:
      return null;
  }
}

export async function routeIntent(
  state: OrderState | null,
  result: Interpretation,
  raw: string,
  tools: FlowTools,
): Promise<StepResult | null> {
  if (result.intent === 'handoff') {
    return handoff(state, tools.phone, requestReasonFor(state), tools);
  }
  const answer = await answerFor(state, result, raw, tools);
  if (!answer) return null;
  if (state) {
    return repeatQuestion(state, tools, answer.offer ? offer(answer.body) : text(answer.body));
  }
  const options = answer.offer ? [handoffButton(), orderStartButton()] : [orderStartButton()];
  if (answer.body.length <= BUTTONS_BODY_LIMIT) {
    return { state: null, replies: [buttons(answer.body, options)] };
  }
  const prompt = answer.offer ? msg.wantAgentOrOrder : msg.wantToOrder;
  return { state: null, replies: [text(answer.body), buttons(prompt, options)] };
}
