const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatMoney(value: number): string {
  return currency.format(value).replace(/\u00a0/g, ' ');
}

const THOUSANDS = /^\d{1,3}(?:\.\d{3})+$/;

function normalize(text: string): string {
  if (text.includes(',')) return text.replace(/\./g, '').replace(',', '.');
  return THOUSANDS.test(text) ? text.replace(/\./g, '') : text;
}

export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/r\$/gi, '').replace(/\s+/g, '');
  if (!cleaned) return null;
  const value = Number(normalize(cleaned));
  return Number.isFinite(value) && value > 0 ? value : null;
}
