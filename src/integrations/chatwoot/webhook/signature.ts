import { createHmac } from 'node:crypto';

const PREFIX = 'sha256=';

export function signChatwootPayload(
  rawBody: Buffer | string,
  timestamp: string,
  secret: string,
): string {
  const hmac = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody);
  return `${PREFIX}${hmac.digest('hex')}`;
}
