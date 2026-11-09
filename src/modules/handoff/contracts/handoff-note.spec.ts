import { describe, expect, it } from 'vitest';
import {
  EXPIRED_NOTE,
  handoffNote,
  REASON_LABELS,
  saleNote,
  WINDOW_CLOSED_NOTE,
} from './handoff-note';

describe('handoffNote', () => {
  it('monta a nota completa', () => {
    const note = handoffNote('customer_request', {
      stepLabel: 'Pagamento',
      identityConfirmed: true,
      newCustomer: true,
      customerName: 'Maria',
      product: 'Botijão P13',
      quantity: 2,
      address: 'Rua A, 10',
      payment: 'Pix',
      total: 220,
    });
    expect(note).toBe(
      [
        'Transferido para atendente',
        'Motivo: Cliente pediu atendente',
        'Etapa: Pagamento',
        'Cliente: Maria (cliente novo)',
        'Produto: 2× Botijão P13',
        'Endereço: Rua A, 10',
        'Pagamento: Pix',
        'Total: R$ 220,00',
      ].join('\n'),
    );
  });

  it('cliente existente não leva o sufixo de novo', () => {
    const note = handoffNote('sale_failed', {
      stepLabel: 'Resumo',
      identityConfirmed: true,
      newCustomer: false,
      customerName: 'Maria',
    });
    expect(note).toContain('Motivo: Falha ao registrar a venda na RevGás');
    expect(note).toContain('Cliente: Maria');
    expect(note).not.toContain('cliente novo');
  });

  it('identidade não confirmada não revela dados do pedido', () => {
    const note = handoffNote('customer_request', {
      stepLabel: 'CPF',
      identityConfirmed: false,
      newCustomer: false,
      customerName: 'Maria',
      product: 'Botijão P13',
      total: 110,
    });
    expect(note).toBe(
      [
        'Transferido para atendente',
        'Motivo: Cliente pediu atendente',
        'Identidade não confirmada: confirme com o cliente antes de passar dados do pedido.',
      ].join('\n'),
    );
    expect(note).not.toContain('Maria');
  });

  it('sem resumo', () => {
    expect(handoffNote('customer_request', null)).toBe(
      'Transferido para atendente\nMotivo: Cliente pediu atendente\nSem pedido em andamento.',
    );
  });

  it('nunca contém 11 dígitos seguidos', () => {
    const note = handoffNote('customer_request', {
      stepLabel: 'Resumo',
      identityConfirmed: true,
      newCustomer: false,
      total: 220,
    });
    expect(note).not.toMatch(/\d{11}/);
  });

  it('textos fixos', () => {
    expect(REASON_LABELS.sale_failed).toBe('Falha ao registrar a venda na RevGás');
    expect(saleNote(123)).toBe('Venda #123 criada pelo bot, saiu da fila.');
    expect(EXPIRED_NOTE).toBe('Handoff expirado, o bot voltou a atender.');
    expect(WINDOW_CLOSED_NOTE).toBe(
      'O cliente está fora da janela de 24 h do WhatsApp: ele precisa mandar uma mensagem antes de você responder.',
    );
  });
});
