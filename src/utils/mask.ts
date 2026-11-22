export const MASK = '***';

function lastChars(value: unknown, size: number): string {
  return String(value).slice(-size);
}

export function maskPhone(value: unknown): string {
  return String(value).length < 4 ? MASK : `*******${lastChars(value, 4)}`;
}

export function maskDocument(value: unknown): string {
  return String(value).length < 2 ? MASK : `${MASK}${lastChars(value, 2)}`;
}
