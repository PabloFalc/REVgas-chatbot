const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatMoney(value: number): string {
  return currency.format(value).replace(/\u00a0/g, ' ');
}

export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/r\$/gi, '').replace(/\s+/g, '');
  if (!cleaned) return null;
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}
