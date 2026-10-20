import { createHmac } from 'node:crypto';
import { safeEqual } from '../../../utils/safe-equal';

const PREFIX = 'sha256=';

export function signPayload(rawBody: Buffer | string, appSecret: string): string {
  return `${PREFIX}${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

export function isValidSignature(
  rawBody: Buffer | string | undefined,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (rawBody === undefined || !header?.startsWith(PREFIX)) {
    return false;
  }
  return safeEqual(signPayload(rawBody, appSecret), header);
}
