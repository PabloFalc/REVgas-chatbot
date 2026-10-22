export function onlyDigits(text: string): string {
  return text.replace(/\D/g, '');
}

function checkDigit(digits: string, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += Number(digits[i]) * (length + 1 - i);
  }
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

export function isValidCpf(text: string): boolean {
  const digits = onlyDigits(text);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  return (
    checkDigit(digits, 9) === Number(digits[9]) && checkDigit(digits, 10) === Number(digits[10])
  );
}

const CPF_PATTERN = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g;

export function removeCpfs(text: string): string {
  return text.replace(CPF_PATTERN, '');
}
