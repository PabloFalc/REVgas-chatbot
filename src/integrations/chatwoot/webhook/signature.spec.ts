import { describe, expect, it } from 'vitest';
import { ChatwootWebhook } from './chatwoot-webhook';
import { signChatwootPayload } from './signature';

const SECRET = '0123456789abcdef0123';
const NOW = 1_760_000_000_000;
const TS = String(NOW / 1000);
const BODY = '{"event":"x"}';

function webhook(secret: string | undefined) {
  return new ChatwootWebhook({ webhookSecret: secret, inboxId: 1 });
}

describe('assinatura do webhook do Chatwoot', () => {
  it('formata como sha256=hex', () => {
    expect(signChatwootPayload(BODY, TS, SECRET)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('aceita assinatura válida', () => {
    expect(webhook(SECRET).isAuthentic(BODY, signChatwootPayload(BODY, TS, SECRET), TS, NOW)).toBe(
      true,
    );
  });

  it('aceita corpo em Buffer', () => {
    expect(
      webhook(SECRET).isAuthentic(
        Buffer.from(BODY),
        signChatwootPayload(BODY, TS, SECRET),
        TS,
        NOW,
      ),
    ).toBe(true);
  });

  it('recusa corpo alterado', () => {
    const signature = signChatwootPayload(BODY, TS, SECRET);
    expect(webhook(SECRET).isAuthentic('{"event":"y"}', signature, TS, NOW)).toBe(false);
  });

  it('recusa segredo errado', () => {
    const signature = signChatwootPayload(BODY, TS, 'outro-segredo');
    expect(webhook(SECRET).isAuthentic(BODY, signature, TS, NOW)).toBe(false);
  });

  it('recusa header sem sha256=', () => {
    const bare = signChatwootPayload(BODY, TS, SECRET).replace('sha256=', '');
    expect(webhook(SECRET).isAuthentic(BODY, bare, TS, NOW)).toBe(false);
  });

  it('recusa timestamp de 301 s atrás e aceita 300 s', () => {
    const old = String(NOW / 1000 - 301);
    const edge = String(NOW / 1000 - 300);
    expect(
      webhook(SECRET).isAuthentic(BODY, signChatwootPayload(BODY, old, SECRET), old, NOW),
    ).toBe(false);
    expect(
      webhook(SECRET).isAuthentic(BODY, signChatwootPayload(BODY, edge, SECRET), edge, NOW),
    ).toBe(true);
  });

  it('recusa timestamp inválido ou ausente e corpo ou assinatura ausentes', () => {
    const signature = signChatwootPayload(BODY, TS, SECRET);
    expect(
      webhook(SECRET).isAuthentic(BODY, signChatwootPayload(BODY, 'abc', SECRET), 'abc', NOW),
    ).toBe(false);
    expect(webhook(SECRET).isAuthentic(BODY, signature, undefined, NOW)).toBe(false);
    expect(webhook(SECRET).isAuthentic(undefined, signature, TS, NOW)).toBe(false);
    expect(webhook(SECRET).isAuthentic(BODY, undefined, TS, NOW)).toBe(false);
  });

  it('recusa tudo sem segredo configurado', () => {
    const signature = signChatwootPayload(BODY, TS, SECRET);
    expect(webhook(undefined).isAuthentic(BODY, signature, TS, NOW)).toBe(false);
  });
});
