import type {
  HandoffOrderSummary,
  HandoffOutcome,
  HandoffReason,
} from 'src/modules/handoff/contracts/handoff.types';
import { normalizeText } from 'src/utils/text';
import type { Reply, ReplyOption } from '../contracts/conversation.types';
import type { FlowTools, OrderState, Step, StepResult } from './flow.types';
import { msg, paymentLine } from './messages';
import { buttons, text } from './replies';

export const HANDOFF_CHOICE = 'handoff:request';

const AGENT_WORDS = ['atendente', 'falar com alguem', 'humano'];

export function asksForAgent(raw: string): boolean {
  const text = normalizeText(raw);
  return AGENT_WORDS.some(word => text.includes(word));
}

const STEP_LABELS: Record<Step, string> = {
  askName: 'Nome do cliente',
  askCpf: 'CPF do cliente',
  askCpfPrefix: 'Confirmação de identidade',
  confirmCpf: 'Confirmação de identidade',
  offerRepeat: 'Oferta de repetir o último pedido',
  chooseAddress: 'Escolha do endereço',
  askNewAddress: 'Novo endereço',
  askAddressField: 'Dados do endereço',
  confirmAddress: 'Confirmação do endereço',
  chooseProduct: 'Escolha do produto',
  searchProduct: 'Busca de produto',
  pickProduct: 'Escolha entre produtos parecidos',
  chooseQuantity: 'Escolha da quantidade',
  askQuantity: 'Quantidade',
  choosePayment: 'Forma de pagamento',
  askNeedsChange: 'Precisa de troco',
  askChangeAmount: 'Valor do troco',
  summary: 'Resumo do pedido',
  chooseCorrection: 'Correção do pedido',
  creatingSale: 'Criando a venda',
  saleFailed: 'Falha ao criar a venda',
};

export const ORDER_START_CHOICE = 'order:start';

export function orderStartButton(): ReplyOption {
  return { id: ORDER_START_CHOICE, title: msg.orderStart };
}

export function handoffButton(): ReplyOption {
  return { id: HANDOFF_CHOICE, title: msg.talkToAgent };
}

export function offer(body: string): Reply {
  return buttons(body, [handoffButton()]);
}

export function handoffSummary(state: OrderState | null): HandoffOrderSummary | null {
  if (!state) return null;
  const stepLabel = STEP_LABELS[state.step];
  if (state.step === 'askCpfPrefix' || state.step === 'confirmCpf') {
    return { stepLabel, identityConfirmed: false, newCustomer: false };
  }
  const { customer, product, quantity, address, payment, quote } = state;
  return {
    stepLabel,
    identityConfirmed: true,
    newCustomer: customer.id === undefined,
    customerName: customer.name,
    product: product?.name,
    quantity,
    address: address ? msg.addressFull(address) : undefined,
    payment: payment ? paymentLine(state) : undefined,
    total: quote?.total,
  };
}

export function requestReasonFor(state: OrderState | null): HandoffReason {
  return state?.step === 'saleFailed' ? 'sale_failed' : 'customer_request';
}

function queueReply(outcome: HandoffOutcome): Reply {
  if (outcome.status === 'queued') {
    return text(outcome.open ? msg.handoffQueued : msg.handoffClosed(outcome.nextOpening));
  }
  return text(msg.handoffAlreadyQueued);
}

export async function handoff(
  state: OrderState | null,
  phone: string,
  reason: HandoffReason,
  tools: FlowTools,
): Promise<StepResult> {
  const outcome = await tools.requestHandoff({ phone, reason, summary: handoffSummary(state) });
  if (outcome.status === 'unavailable') {
    return { state, replies: [text(msg.talkToStore(tools.storePhone))] };
  }
  return { state, replies: [queueReply(outcome)] };
}

export async function identityHandoff(
  state: OrderState | null,
  phone: string,
  tools: FlowTools,
  keep: {
    state: OrderState | null;
    summary: HandoffOrderSummary | null;
    requested?: boolean;
  } = {
    state: null,
    summary: handoffSummary(state),
  },
): Promise<StepResult> {
  const outcome = await tools.requestHandoff({
    phone,
    reason: 'identity_failure',
    summary: keep.summary,
  });
  if (outcome.status === 'unavailable') {
    return { state: keep.state, replies: [text(msg.identityContactStore(tools.storePhone))] };
  }
  const queued = queueReply(outcome);
  const replies = keep.requested ? [queued] : [text(msg.identityHandoff), queued];
  return { state: keep.state, replies };
}
