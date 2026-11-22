const LABELS: Record<string, string> = {
  PIX: 'Pix',
  MONEY: 'Dinheiro',
  CARTAO_DE_CREDITO: 'Cartão de crédito',
  CARTAO_DE_DEBITO: 'Cartão de débito',
  VALEGAS: 'Vale-gás',
  TRANSFERENCIA_BANCARIA: 'Transferência',
};

export function paymentLabel(type: string): string {
  const known = LABELS[type];
  if (known) return known;
  const text = type.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
