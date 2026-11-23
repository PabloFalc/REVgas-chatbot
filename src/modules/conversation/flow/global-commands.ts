import type { Interpretation } from 'src/modules/assistant/contracts/assistant.types';
import { hasProfanity } from 'src/utils/profanity';
import { normalizeText } from 'src/utils/text';
import { detectEmergency } from './emergency';
import type { FlowInput, FlowTools, OrderState, StepResult } from './flow.types';
import {
  asksForAgent,
  HANDOFF_CHOICE,
  handoff,
  ORDER_START_CHOICE,
  offer,
  requestReasonFor,
} from './handoff';
import { textOf } from './input';
import { routeIntent } from './intent';
import { msg } from './messages';
import { isOrderStatusQuestion, orderStatus } from './order-status';
import { repeatQuestion } from './repeat-question';
import { text as textReply } from './replies';
import { asks, start } from './steps';
import { cancelAfterFailedSale } from './steps/summary.step';

const CANCEL = ['cancelar', 'cancela', 'cancelar pedido'];
const DISCOUNT = ['desconto', 'promocao', 'mais barato'];
const OFFENSE: Interpretation = { intent: 'offense', confidence: 1 };

export async function globalCommand(
  state: OrderState | null,
  input: FlowInput,
  tools: FlowTools,
): Promise<StepResult | null> {
  if (input.content.type === 'unsupported') {
    if (!state) return start(input, tools);
    return repeatQuestion(state, tools, offer(msg.textOnly));
  }

  const raw = textOf(input);
  if (raw !== null && detectEmergency(raw)) {
    const outcome = await handoff(state, input.phone, 'emergency', tools);
    return { ...outcome, replies: [textReply(msg.emergency), ...outcome.replies] };
  }

  if (raw !== null && hasProfanity(raw)) return routeIntent(state, OFFENSE, raw, tools);

  if (input.content.type === 'choice' && input.content.id === HANDOFF_CHOICE) {
    return handoff(state, input.phone, requestReasonFor(state), tools);
  }

  if (input.content.type === 'choice' && input.content.id === ORDER_START_CHOICE) {
    if (!state) return start(input, tools);
    const ask = asks[state.step];
    if (!ask) return { state, replies: [] };
    return ask(state, tools);
  }

  if (raw === null) return null;
  const text = normalizeText(raw);

  if (CANCEL.includes(text)) {
    if (state?.step === 'creatingSale') return { state, replies: [textReply(msg.saleInProgress)] };
    if (state?.step === 'saleFailed') return cancelAfterFailedSale(state, tools);
    return { state: null, replies: [textReply(msg.cancelled)] };
  }

  if (asksForAgent(raw)) {
    return handoff(state, input.phone, requestReasonFor(state), tools);
  }

  if (isOrderStatusQuestion(raw)) return orderStatus(state, tools);

  if (DISCOUNT.some(word => text.includes(word))) {
    if (!state) return { state, replies: [textReply(msg.noDiscount)] };
    return repeatQuestion(state, tools, textReply(msg.noDiscount));
  }

  return null;
}
