import { describe, expect, it } from 'vitest';
import { type Env, envConfigSchema } from '../../../config/env';
import { resolveWhatsappConfig } from './whatsapp.config';

const base = { DATABASE_URL: 'postgresql://docker:docker@localhost:5432/revgas' };

const parse = (extra: Record<string, unknown> = {}): Env =>
  envConfigSchema.parse({ ...base, ...extra });

const accepts = (extra: Record<string, unknown>) =>
  envConfigSchema.safeParse({ ...base, ...extra }).success;

const live = {
  WHATSAPP_ACCESS_TOKEN: 'EAAG-token-de-teste-com-mais-de-32-caracteres',
  WHATSAPP_PHONE_NUMBER_ID: '123456789',
  WHATSAPP_APP_SECRET: '0123456789abcdef0123456789abcdef',
  WHATSAPP_VERIFY_TOKEN: 'verify-token-de-teste',
};

describe('resolveWhatsappConfig', () => {
  it('usa fake quando não há token', () => {
    const config = resolveWhatsappConfig(parse());
    expect(config.mode).toBe('fake');
    expect(config.baseUrl).toBe('https://graph.facebook.com');
    expect(config.apiVersion).toBe('v23.0');
    expect(config.timeoutMs).toBe(10000);
  });

  it('usa live quando há token e WHATSAPP_MODE não foi definido', () => {
    const config = resolveWhatsappConfig(parse(live));
    expect(config.mode).toBe('live');
    expect(config.phoneNumberId).toBe('123456789');
  });

  it('respeita WHATSAPP_MODE=fake mesmo com token', () => {
    expect(resolveWhatsappConfig(parse({ ...live, WHATSAPP_MODE: 'fake' })).mode).toBe('fake');
  });

  it('falha em live listando o que falta', () => {
    expect(() =>
      resolveWhatsappConfig(
        parse({ WHATSAPP_MODE: 'live', WHATSAPP_ACCESS_TOKEN: live.WHATSAPP_ACCESS_TOKEN }),
      ),
    ).toThrow(/WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN/);
  });

  it('recusa versão e phone number id mal formados', () => {
    expect(accepts({ WHATSAPP_API_VERSION: '23' })).toBe(false);
    expect(accepts({ WHATSAPP_PHONE_NUMBER_ID: '+55 86' })).toBe(false);
    expect(accepts({ WHATSAPP_API_VERSION: 'v24.0', WHATSAPP_PHONE_NUMBER_ID: '123' })).toBe(true);
  });

  it('recusa verify token, app secret e access token curtos', () => {
    expect(accepts({ WHATSAPP_VERIFY_TOKEN: 'curto' })).toBe(false);
    expect(accepts({ WHATSAPP_APP_SECRET: 'segredo' })).toBe(false);
    expect(accepts({ WHATSAPP_ACCESS_TOKEN: 'token' })).toBe(false);
  });

  it('em produção exige app secret e verify token mesmo no modo fake', () => {
    const production = { NODE_ENV: 'production', CORS_ORIGIN: 'https://painel.exemplo.com' };
    expect(() => resolveWhatsappConfig(parse(production))).toThrow(
      /WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN obrigatório\(s\) em produção/,
    );
    const config = resolveWhatsappConfig(
      parse({
        ...production,
        WHATSAPP_APP_SECRET: live.WHATSAPP_APP_SECRET,
        WHATSAPP_VERIFY_TOKEN: live.WHATSAPP_VERIFY_TOKEN,
      }),
    );
    expect(config.mode).toBe('fake');
  });
});
