import { removeCpfMentions, removeCpfs } from './cpf';

const EMAIL_PATTERN = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

const PHONE_PATTERN =
  /(?<!\d)(?:\+?55[\s.-]?)?(?:\(\d{2}\)\s?|\d{2}[\s.-]?)9?\d{4}[\s.-]?\d{4}(?!\d)|(?<!\d)9?\d{4}[\s.-]\d{4}(?!\d)|(?<!\d)9\d{8}(?!\d)/g;

export const PII_MARKER = /\[(?:CPF|telefone|e-mail)\]/g;

export function sanitizeForLlm(text: string): string {
  const withoutEmails = text.replace(EMAIL_PATTERN, '[e-mail]');
  const withoutCpfs = removeCpfs(removeCpfMentions(withoutEmails, '[CPF]'), '[CPF]');
  return withoutCpfs.replace(PHONE_PATTERN, '[telefone]');
}
