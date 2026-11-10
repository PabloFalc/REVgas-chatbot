import { formatMoney } from 'src/utils/money';
import type { HandoffOrderSummary, HandoffReason } from './handoff.types';

export const REASON_LABELS: Record<HandoffReason, string> = {
  customer_request: 'Cliente pediu atendente',
  sale_failed: 'Falha ao registrar a venda na RevGás',
};

export const EXPIRED_NOTE = 'Handoff expirado, o bot voltou a atender.';

export const WINDOW_CLOSED_NOTE =
  'O cliente está fora da janela de 24 h do WhatsApp: ele precisa mandar uma mensagem antes de você responder.';

export function saleNote(saleId: number): string {
  return `Venda #${saleId} criada pelo bot, saiu da fila.`;
}

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
