import { describe, expect, it } from 'vitest';
import { textWebhook } from '../testing/webhook.testing';
import { isValidSignature, signPayload } from './signature';
import { WhatsappWebhook } from './whatsapp-webhook';

const SECRET = 'app-secret';
const VERIFY = 'verify-token-de-teste';

describe('isValidSignature', () => {
  const raw = Buffer.from(JSON.stringify(textWebhook('oi')));

  it('aceita a assinatura HMAC-SHA256 do corpo cru', () => {
    expect(isValidSignature(raw, signPayload(raw, SECRET), SECRET)).toBe(true);
  });

  it('recusa assinatura ausente, sem prefixo, de outro segredo ou de outro corpo', () => {
    expect(isValidSignature(raw, undefined, SECRET)).toBe(false);
    expect(isValidSignature(raw, signPayload(raw, SECRET).slice(7), SECRET)).toBe(false);
    expect(isValidSignature(raw, signPayload(raw, 'outro'), SECRET)).toBe(false);
    expect(isValidSignature(Buffer.from('{}'), signPayload(raw, SECRET), SECRET)).toBe(false);
    expect(isValidSignature(undefined, signPayload(raw, SECRET), SECRET)).toBe(false);
  });
});

describe('WhatsappWebhook', () => {
  const webhook = new WhatsappWebhook({
    appSecret: SECRET,
    verifyToken: VERIFY,
    phoneNumberId: '1122334455',
  });

  it('devolve o challenge quando o verify token confere', () => {
    expect(
      webhook.challenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY,
        'hub.challenge': '12345',
      }),
    ).toBe('12345');
  });

  it('recusa verify token errado, modo errado ou sem token configurado', () => {
    const query = { 'hub.mode': 'subscribe', 'hub.challenge': '1' };
    expect(webhook.challenge({ ...query, 'hub.verify_token': 'errado' })).toBeNull();
    expect(
      webhook.challenge({ ...query, 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY }),
    ).toBeNull();
    expect(new WhatsappWebhook({}).challenge({ ...query, 'hub.verify_token': VERIFY })).toBeNull();
  });

  it('confere a assinatura quando há app secret e aceita sem ela quando não há', () => {
    const raw = '{"a":1}';
    expect(webhook.isAuthentic(raw, undefined)).toBe(false);
    expect(webhook.isAuthentic(raw, signPayload(raw, SECRET))).toBe(true);
    expect(new WhatsappWebhook({}).isAuthentic(raw, undefined)).toBe(true);
  });

  it('descarta eventos de outro número da mesma conta', () => {
    expect(webhook.parse(textWebhook('oi'))).toHaveLength(1);
    const other = textWebhook('oi');
    other.entry[0].changes[0].value.metadata.phone_number_id = '999';
    expect(webhook.parse(other)).toEqual([]);
    const missing = textWebhook('oi') as { entry: Array<{ changes: Array<{ value: object }> }> };
    delete (missing.entry[0].changes[0].value as { metadata?: unknown }).metadata;
    expect(webhook.parse(missing)).toEqual([]);
  });
});
