import type { OrderStatus } from 'src/modules/order/contracts/order.types';
import { normalizeText } from 'src/utils/text';
import type { FlowTools, OrderState, StepResult } from './flow.types';
import { identityHandoff, offer, orderStartButton } from './handoff';
import { resolveIdentity } from './identity';
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

function statusText(sale: OrderStatus, tools: FlowTools): string {
  return tools.demo ? msg.demoOrderStatus(sale) : msg.orderStatus(sale);
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
      ? offer(statusText(sale, tools))
      : text(statusText(sale, tools))
    : buttons(msg.noRecentOrderForPhone, [orderStartButton()]);
  if (state) {
    const answered = await repeatQuestion(state, tools, reply);
    return answered;
  }
  return { state: null, replies: [reply] };
}

export async function orderStatus(state: OrderState | null, tools: FlowTools): Promise<StepResult> {
  const identity = await resolveIdentity(tools.phone, tools);
  switch (identity.kind) {
    case 'new': {
      const reply = buttons(msg.noOrderForPhone, [orderStartButton()]);
      if (!state) return { state, replies: [reply] };
      const answered = await repeatQuestion(state, tools, reply);
      return answered;
    }
    case 'handoff':
      return identityHandoff(state, tools.phone, tools, { state, summary: null });
    case 'verified':
      return answerOrderStatus(state, identity.customer.id, tools);
    case 'ask':
      return {
        state: {
          ...state,
          step: 'confirmCpf',
          customer: {},
          pendingOrderStatus: state?.pendingOrderStatus ?? {
            resumeStep: state?.step ?? null,
            customer: state?.customer ?? {},
          },
        },
        replies: [text(msg.askFullCpf)],
      };
  }
}
