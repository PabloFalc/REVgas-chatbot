import { describe, expect, it, vi } from 'vitest';
import { textWebhook, webhookPayload } from '../testing/webhook.testing';
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
    allowedSenders: [],
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
    expect(
      new WhatsappWebhook({ allowedSenders: [] }).challenge({
        ...query,
        'hub.verify_token': VERIFY,
      }),
    ).toBeNull();
  });

  it('confere a assinatura quando há app secret e aceita sem ela quando não há', () => {
    const raw = '{"a":1}';
    expect(webhook.isAuthentic(raw, undefined)).toBe(false);
    expect(webhook.isAuthentic(raw, signPayload(raw, SECRET))).toBe(true);
    expect(new WhatsappWebhook({ allowedSenders: [] }).isAuthentic(raw, undefined)).toBe(true);
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

  it('com WHATSAPP_ALLOWED_SENDERS descarta mensagens de outros números e loga mascarado', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const restricted = new WhatsappWebhook(
      { phoneNumberId: '1122334455', allowedSenders: ['5586999991234'] },
      logger,
    );
    expect(restricted.parse(textWebhook('oi'))).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalled();

    expect(restricted.parse(textWebhook('oi', 'wamid.X', '5586988887777'))).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('5586988887777');
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ from: '*******7777' });
  });

  it('a allowlist não descarta status de entrega', () => {
    const restricted = new WhatsappWebhook({ allowedSenders: ['5586999991234'] });
    const status = webhookPayload({
      statuses: [{ id: 'wamid.OUT', status: 'delivered', recipient_id: '5586988887777' }],
    });
    expect(restricted.parse(status)).toHaveLength(1);
  });
});
