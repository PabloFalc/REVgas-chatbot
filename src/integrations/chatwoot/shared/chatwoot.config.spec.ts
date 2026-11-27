import { describe, expect, it } from 'vitest';
import { type Env, envConfigSchema } from '../../../config/env';
import { resolveChatwootConfig } from './chatwoot.config';

const base = { DATABASE_URL: 'postgresql://docker:docker@localhost:5432/revgas' };

const parse = (extra: Record<string, unknown> = {}): Env =>
  envConfigSchema.parse({ ...base, ...extra });

const live = {
  CHATWOOT_ACCOUNT_ID: '1',
  CHATWOOT_INBOX_ID: '2',
  CHATWOOT_API_TOKEN: 'api-token',
  CHATWOOT_BOT_TOKEN: 'bot-token',
  CHATWOOT_WEBHOOK_SECRET: '0123456789abcdef0123',
};

describe('resolveChatwootConfig', () => {
  it('usa off sem modo e sem token', () => {
    expect(resolveChatwootConfig(parse()).mode).toBe('off');
  });

  it('off descarta o segredo do webhook para recusar tudo', () => {
    const config = resolveChatwootConfig(
      parse({ CHATWOOT_MODE: 'off', CHATWOOT_WEBHOOK_SECRET: '0123456789abcdef0123' }),
    );
    expect(config.mode).toBe('off');
    expect(config.webhookSecret).toBeUndefined();
  });

  it('usa live com token e sem modo', () => {
    const config = resolveChatwootConfig(parse(live));
    expect(config.mode).toBe('live');
    expect(config.accountId).toBe(1);
    expect(config.inboxId).toBe(2);
    expect(config.timeoutMs).toBe(5000);
  });

  it('falha em live listando o que falta', () => {
    const { CHATWOOT_BOT_TOKEN: _omit, ...rest } = live;
    expect(() => resolveChatwootConfig(parse(rest))).toThrow(/CHATWOOT_BOT_TOKEN/);
  });

  it('fake sem inbox usa 1', () => {
    const config = resolveChatwootConfig(parse({ CHATWOOT_MODE: 'fake' }));
    expect(config.mode).toBe('fake');
    expect(config.inboxId).toBe(1);
  });

  it('remove a barra final da URL', () => {
    expect(resolveChatwootConfig(parse({ CHATWOOT_URL: 'http://chat.test:3000/' })).baseUrl).toBe(
      'http://chat.test:3000',
    );
  });
});

describe('resolveChatwootConfig em produção', () => {
  const prod = {
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://app.test',
    REDIS_PASSWORD: 'x',
    WHATSAPP_ALLOWED_SENDERS: '5586988887777',
  };

  it('em produção falha sem Chatwoot live e sem STORE_PHONE', () => {
    expect(() => resolveChatwootConfig(parse(prod))).toThrow(/STORE_PHONE/);
    expect(() => resolveChatwootConfig(parse({ ...prod, CHATWOOT_MODE: 'off' }))).toThrow(
      /STORE_PHONE/,
    );
  });

  it('em produção recusa o modo fake', () => {
    expect(() =>
      resolveChatwootConfig(
        parse({ ...prod, CHATWOOT_MODE: 'fake', STORE_PHONE: '5586988887777' }),
      ),
    ).toThrow(/CHATWOOT_MODE/);
  });

  it('em produção aceita Chatwoot off com STORE_PHONE', () => {
    const config = resolveChatwootConfig(
      parse({ ...prod, CHATWOOT_MODE: 'off', STORE_PHONE: '5586988887777' }),
    );
    expect(config.mode).toBe('off');
  });

  it('em produção mantém a validação do live', () => {
    const { CHATWOOT_BOT_TOKEN: _omit, ...rest } = live;
    expect(() => resolveChatwootConfig(parse({ ...prod, ...rest }))).toThrow(/CHATWOOT_BOT_TOKEN/);
    expect(resolveChatwootConfig(parse({ ...prod, ...live })).mode).toBe('live');
  });
});
