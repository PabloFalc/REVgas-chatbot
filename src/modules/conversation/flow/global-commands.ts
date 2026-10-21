import { normalizeText } from 'src/utils/text';
import type { FlowInput, FlowTools, OrderState, StepResult } from './flow.types';
import { textOf } from './input';
import { msg } from './messages';
import { asks, start } from './steps';

const CANCEL = ['cancelar', 'cancela', 'cancelar pedido'];
const STORE = ['atendente', 'falar com alguem', 'humano'];
const DISCOUNT = ['desconto', 'promocao', 'mais barato'];

async function repeatQuestion(
  state: OrderState,
  tools: FlowTools,
  first: StepResult['replies'][number],
): Promise<StepResult> {
  const ask = asks[state.step];
  const asked = ask ? (await ask(state, tools)).replies : [];
  return { state, replies: [first, ...asked] };
}

export async function globalCommand(
  state: OrderState | null,
  input: FlowInput,
  tools: FlowTools,
): Promise<StepResult | null> {
  if (input.content.type === 'unsupported') {
    if (!state) return start(input, tools);
    return repeatQuestion(state, tools, msg.textOnly);
  }

  const raw = textOf(input);
  if (raw === null) return null;
  const text = normalizeText(raw);

  if (CANCEL.includes(text)) return { state: null, replies: [msg.cancelled] };

  if (STORE.some(word => text.includes(word))) {
    return { state, replies: [msg.talkToStore(tools.storePhone)] };
  }

  if (DISCOUNT.some(word => text.includes(word))) {
    if (!state) return { state, replies: [msg.noDiscount] };
    return repeatQuestion(state, tools, msg.noDiscount);
  }

  return null;
}
