import type {
  HandoffOrderSummary,
  HandoffReason,
} from 'src/modules/handoff/contracts/handoff.types';
import type { ReplyOption } from '../contracts/conversation.types';
import type { FlowTools, OrderState, Step, StepResult } from './flow.types';
import { msg, paymentLine } from './messages';
import { text } from './replies';

export const HANDOFF_CHOICE = 'handoff:request';

const STEP_LABELS: Record<Step, string> = {
  askName: 'Nome do cliente',
  askCpf: 'CPF do cliente',
  askCpfPrefix: 'Confirmação de identidade',
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

export function handoffButton(): ReplyOption {
  return { id: HANDOFF_CHOICE, title: msg.talkToAgent };
}

export function handoffSummary(state: OrderState | null): HandoffOrderSummary | null {
  if (!state) return null;
  const stepLabel = STEP_LABELS[state.step];
  if (state.step === 'askCpfPrefix') {
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
  if (outcome.status === 'queued') {
    const body = outcome.open ? msg.handoffQueued : msg.handoffClosed(outcome.nextOpening);
    return { state, replies: [text(body)] };
  }
  return { state, replies: [text(msg.handoffAlreadyQueued)] };
}
