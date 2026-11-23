import { normalizeText } from 'src/utils/text';
import type { FlowTools, OrderState, StepResult } from './flow.types';
import { offer, orderStartButton } from './handoff';
import { msg } from './messages';
import { repeatQuestion } from './repeat-question';
import { buttons, text } from './replies';

const STATUS_PHRASES = [
  /\bstatus (?:do |de |de um |do meu )?pedido\b/,
  /\b(?:cade|onde esta|onde ta) (?:o )?meu (?:gas|pedido|botijao)\b/,
  /\bmeu (?:gas|pedido|botijao) (?:ja )?chegou\b/,
  /\b(?:ja )?saiu (?:pra|para a|para) entrega\b/,
];

export function isOrderStatusQuestion(raw: string): boolean {
  const normalized = normalizeText(raw).replace(/[^a-z0-9\s]/g, ' ');
  return STATUS_PHRASES.some(phrase => phrase.test(normalized));
}

export async function answerOrderStatus(
  state: OrderState | null,
  customerId: number,
  tools: FlowTools,
): Promise<StepResult> {
  if (state?.pendingOrderStatus) {
    const { pendingOrderStatus, ...rest } = state;
    state =
      pendingOrderStatus.resumeStep === null
        ? null
        : {
            ...rest,
            step: pendingOrderStatus.resumeStep,
            customer: pendingOrderStatus.customer,
          };
  }
  const found = await tools.latestOrderStatus(customerId, tools.now());
  const sale = found?.status === 'WARN' ? { ...found, status: 'WARNING' } : found;
  const reply = sale
    ? sale.status === 'WARNING'
      ? offer(msg.orderStatus(sale))
      : text(msg.orderStatus(sale))
    : buttons(msg.noRecentOrderForPhone, [orderStartButton()]);
  if (state) {
    const answered = await repeatQuestion(state, tools, reply);
    return answered;
  }
  return { state: null, replies: [reply] };
}

export async function orderStatus(state: OrderState | null, tools: FlowTools): Promise<StepResult> {
  const customer = await tools.findCustomer(tools.phone);
  if (!customer) {
    const reply = buttons(msg.noOrderForPhone, [orderStartButton()]);
    if (!state) return { state, replies: [reply] };
    const answered = await repeatQuestion(state, tools, reply);
    return answered;
  }
  if (!customer.cpf || (await tools.isBlocked(tools.phone))) {
    return { state, replies: [text(msg.identityContactStore(tools.storePhone))] };
  }
  if (await tools.isVerified(tools.phone, customer.id)) {
    return answerOrderStatus(state, customer.id, tools);
  }
  return {
    state: {
      ...state,
      step: 'askCpfPrefix',
      customer: {
        ...state?.customer,
        id: customer.id,
        name: customer.name,
        cpfPrefix: customer.cpf.slice(0, 3),
        tagId: customer.tagId,
      },
      pendingOrderStatus: state?.pendingOrderStatus ?? {
        resumeStep: state?.step ?? null,
        customer: state?.customer ?? {},
      },
    },
    replies: [text(msg.askCpfPrefix)],
  };
}
