import { normalizeText } from 'src/utils/text';
import type { FlowInput, FlowTools, OrderState, StepResult } from './flow.types';
import { textOf } from './input';
import { msg } from './messages';
import { text as textReply } from './replies';
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
  if (!ask) return { state, replies: [first] };
  const asked = await ask(state, tools);
  return { state: asked.state, replies: [first, ...asked.replies] };
}

export async function globalCommand(
  state: OrderState | null,
  input: FlowInput,
  tools: FlowTools,
): Promise<StepResult | null> {
  if (input.content.type === 'unsupported') {
    if (!state) return start(input, tools);
    return repeatQuestion(state, tools, textReply(msg.textOnly));
  }

  const raw = textOf(input);
  if (raw === null) return null;
  const text = normalizeText(raw);

  if (CANCEL.includes(text)) {
    if (state?.step === 'creatingSale') return { state, replies: [textReply(msg.saleInProgress)] };
    return { state: null, replies: [textReply(msg.cancelled)] };
  }

  if (STORE.some(word => text.includes(word))) {
    return { state, replies: [textReply(msg.talkToStore(tools.storePhone))] };
  }

  if (DISCOUNT.some(word => text.includes(word))) {
    if (!state) return { state, replies: [textReply(msg.noDiscount)] };
    return repeatQuestion(state, tools, textReply(msg.noDiscount));
  }

  return null;
}
