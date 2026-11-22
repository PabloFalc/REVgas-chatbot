import { MASK, maskDocument, maskPhone } from '../../../utils/mask';

export function maskQuery(query: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    if (key === 'phone') {
      masked[key] = maskPhone(value);
    } else if (key === 'cpf_or_cnpj') {
      masked[key] = maskDocument(value);
    } else if (key === 'name' || key === 'location') {
      masked[key] = MASK;
    } else {
      masked[key] = value;
    }
  }
  return masked;
}
