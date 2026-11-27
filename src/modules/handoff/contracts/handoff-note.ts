import { formatMoney } from 'src/utils/money';
import type { HandoffOrderSummary, HandoffReason } from './handoff.types';

export const REASON_LABELS: Record<HandoffReason, string> = {
  customer_request: 'Cliente pediu atendente',
  emergency: 'Emergência: cliente relatou possível vazamento de gás',
  sale_failed: 'Falha ao registrar a venda na RevGás',
  sale_rejected: 'Venda rejeitada pela RevGás (nenhuma venda registrada)',
  sale_uncertain: 'Resultado incerto; verificar no ERP se a venda foi registrada',
  sale_cancellation: 'Cliente pediu cancelamento de venda registrada',
  quantity_limit: 'Quantidade acima do limite do bot',
  identity_failure: 'Falha na confirmação de identidade do cliente',
};

export const EMERGENCY_NOTE = REASON_LABELS.emergency;

export const EXPIRED_NOTE = 'Handoff expirado, o bot voltou a atender.';

export const WINDOW_CLOSED_NOTE =
  'O cliente está fora da janela de 24 h do WhatsApp: ele precisa mandar uma mensagem antes de você responder.';

const IDENTITY_UNCONFIRMED_LINE =
  'Identidade não confirmada: confirme com o cliente antes de passar dados do pedido.';

function summaryLines(summary: HandoffOrderSummary): string[] {
  if (!summary.identityConfirmed) {
    return [IDENTITY_UNCONFIRMED_LINE];
  }
  const lines = [`Etapa: ${summary.stepLabel}`];
  if (summary.customerName) {
    lines.push(`Cliente: ${summary.customerName}${summary.newCustomer ? ' (cliente novo)' : ''}`);
  }
  if (summary.product) {
    const quantity = summary.quantity ? `${summary.quantity}× ` : '';
    lines.push(`Produto: ${quantity}${summary.product}`);
  }
  if (summary.address) lines.push(`Endereço: ${summary.address}`);
  if (summary.payment) lines.push(`Pagamento: ${summary.payment}`);
  if (summary.total !== undefined) lines.push(`Total: ${formatMoney(summary.total)}`);
  return lines;
}

export function handoffNote(reason: HandoffReason, summary: HandoffOrderSummary | null): string {
  const lines = ['Transferido para atendente', `Motivo: ${REASON_LABELS[reason]}`];
  if (!summary) {
    lines.push('Sem pedido em andamento.', IDENTITY_UNCONFIRMED_LINE);
  } else {
    lines.push(...summaryLines(summary));
  }
  return lines.join('\n');
}
