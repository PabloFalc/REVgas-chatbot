const MASK = '***';

function tail(value: unknown, size: number): string {
  return String(value).slice(-size);
}

export function maskQuery(query: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key === 'phone') {
      masked[key] = `*******${tail(value, 4)}`;
    } else if (key === 'cpf_or_cnpj') {
      masked[key] = `${MASK}${tail(value, 2)}`;
    } else if (key === 'name' || key === 'location') {
      masked[key] = MASK;
    } else {
      masked[key] = value;
    }
  }
  return masked;
}
