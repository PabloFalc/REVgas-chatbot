import { describe, expect, it, vi } from 'vitest';
import { WhatsappInvalidMessageError } from '../../core/erros/whatsapp/whatsapp.errors';
import { CloudApiWhatsappClient } from './cloud-api-whatsapp.client';
import { FakeWhatsappClient } from './fake-whatsapp.client';
import type { WhatsappConfig } from './shared/whatsapp.config';
import { createWhatsappClient, createWhatsappWebhook } from './whatsapp.factory';

const config = (overrides: Partial<WhatsappConfig> = {}): WhatsappConfig => ({
  mode: 'fake',
  baseUrl: 'https://graph.test',
  apiVersion: 'v23.0',
  accessToken: 'token',
  phoneNumberId: '1122334455',
  appSecret: 'secret',
  verifyToken: 'verify-token-de-teste',
  timeoutMs: 1000,
  ...overrides,
});

const logger = () => ({ info: vi.fn(), warn: vi.fn() });

describe('createWhatsappClient', () => {
  it('mode fake → FakeWhatsappClient', () => {
    expect(createWhatsappClient(config())).toBeInstanceOf(FakeWhatsappClient);
  });

  it('mode live → CloudApiWhatsappClient', () => {
    expect(createWhatsappClient(config({ mode: 'live' }))).toBeInstanceOf(CloudApiWhatsappClient);
  });

  it('avisa quando roda simulado em produção', () => {
    const log = logger();
    createWhatsappClient(config(), { logger: log, nodeEnv: 'production' });
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('createWhatsappWebhook usa o segredo e o número da configuração', () => {
    expect(createWhatsappWebhook(config()).isAuthentic('{}', undefined)).toBe(false);
  });
});

describe('FakeWhatsappClient', () => {
  it('registra o que foi enviado e lido, com ids sequenciais', async () => {
    const client = new FakeWhatsappClient();
    await expect(client.sendText({ to: '5586999991234', text: 'oi' })).resolves.toEqual({
      id: 'wamid.fake.1',
    });
    await client.sendButtons({
      to: '5586999991234',
      body: 'Confirma?',
      buttons: [{ id: 'sim', title: 'Sim' }],
    });
    await client.markAsRead('wamid.IN');

    expect(client.sent.map(message => message.type)).toEqual(['text', 'buttons']);
    expect(client.read).toEqual(['wamid.IN']);

    client.clear();
    expect(client.sent).toEqual([]);
  });

  it('aplica os mesmos limites do cliente real', async () => {
    const client = new FakeWhatsappClient();
    await expect(
      client.sendList({ to: '5586999991234', body: 'x', buttonText: 'Ver', sections: [] }),
    ).rejects.toBeInstanceOf(WhatsappInvalidMessageError);
  });

  it('só loga o conteúdo quando pedido e mascara o telefone', async () => {
    const quiet = logger();
    await new FakeWhatsappClient({ logger: quiet }).sendText({ to: '5586999991234', text: 'oi' });
    expect(quiet.info.mock.calls[0][0]).not.toHaveProperty('preview');
    expect(quiet.info.mock.calls[0][0]).toMatchObject({ to: '*******1234' });

    const verbose = logger();
    await new FakeWhatsappClient({ logger: verbose, logContent: true }).sendText({
      to: '5586999991234',
      text: 'oi',
    });
    expect(verbose.info.mock.calls[0][0]).toMatchObject({ preview: 'oi' });
  });
});
