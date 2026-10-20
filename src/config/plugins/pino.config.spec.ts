import { describe, expect, it } from 'vitest';
import { redactUrl } from './pino.config';

describe('redactUrl', () => {
  it('esconde o verify token do webhook do WhatsApp', () => {
    expect(
      redactUrl('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=segredo&hub.challenge=1'),
    ).toBe('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=[REDACTED]&hub.challenge=1');
    expect(redactUrl('/x?hub.verify_token=segredo')).toBe('/x?hub.verify_token=[REDACTED]');
  });

  it('mantém as demais URLs', () => {
    expect(redactUrl('/health')).toBe('/health');
    expect(redactUrl(undefined)).toBe('');
  });
});
