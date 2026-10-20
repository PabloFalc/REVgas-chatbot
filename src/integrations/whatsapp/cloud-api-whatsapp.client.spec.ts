import { describe, expect, it, vi } from 'vitest';
import {
  WhatsappInvalidMessageError,
  WhatsappRateLimitedError,
  WhatsappRejectedError,
  WhatsappResponseError,
  WhatsappUnauthorizedError,
  WhatsappUnavailableError,
  WhatsappUnknownOutcomeError,
} from '../../core/erros/whatsapp/whatsapp.errors';
import { CloudApiWhatsappClient } from './cloud-api-whatsapp.client';

const TOKEN = 'EAAG-token-secreto';
const PHONE = '5586999991234';

function setup(responses: Array<{ body: unknown; status?: number } | Error>) {
  const queue = [...responses];
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift() ?? { body: {} };
    if (next instanceof Error) {
      throw next;
    }
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  });
  const logger = { info: vi.fn(), warn: vi.fn() };
  const client = new CloudApiWhatsappClient({
    baseUrl: 'https://graph.test/',
    apiVersion: 'v23.0',
    phoneNumberId: '1122334455',
    accessToken: TOKEN,
    timeoutMs: 1000,
    logger,
    fetch: fetchMock as unknown as typeof fetch,
  });
  const call = (index = 0) => {
    const [url, init] = fetchMock.mock.calls[index];
    return {
      url: String(url),
      init: init as RequestInit,
      body: JSON.parse(String(init?.body)),
    };
  };
  return { client, fetchMock, logger, call };
}

const ok = (id = 'wamid.ABC') => ({
  body: { messaging_product: 'whatsapp', contacts: [{ wa_id: PHONE }], messages: [{ id }] },
});

const graphError = (status: number, code: number) => ({
  status,
  body: { error: { message: `erro ${code}`, type: 'OAuthException', code, fbtrace_id: 'x' } },
});

describe('CloudApiWhatsappClient', () => {
  it('envia texto para /{versão}/{phone_number_id}/messages com Bearer', async () => {
    const { client, call } = setup([ok()]);

    await expect(client.sendText({ to: PHONE, text: 'Olá' })).resolves.toEqual({ id: 'wamid.ABC' });

    const { url, init, body } = call();
    expect(url).toBe('https://graph.test/v23.0/1122334455/messages');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(body).toMatchObject({ to: PHONE, type: 'text', text: { body: 'Olá' } });
  });

  it('envia botões e lista como mensagens interativas', async () => {
    const { client, call } = setup([ok('1'), ok('2')]);

    await client.sendButtons({
      to: PHONE,
      body: 'Confirma?',
      buttons: [{ id: 'sim', title: 'Sim' }],
    });
    await client.sendList({
      to: PHONE,
      body: 'Escolha',
      buttonText: 'Ver',
      sections: [{ rows: [{ id: 'p13', title: 'P13' }] }],
    });

    expect(call(0).body.interactive.type).toBe('button');
    expect(call(1).body.interactive.type).toBe('list');
  });

  it('marca como lida', async () => {
    const { client, call } = setup([{ body: { success: true } }]);
    await client.markAsRead('wamid.IN');
    expect(call().body).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.IN',
    });
  });

  it('valida a mensagem antes de chamar a API', async () => {
    const { client, fetchMock } = setup([]);
    await expect(client.sendText({ to: PHONE, text: '' })).rejects.toBeInstanceOf(
      WhatsappInvalidMessageError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [graphError(401, 190), WhatsappUnauthorizedError],
    [graphError(400, 190), WhatsappUnauthorizedError],
    [graphError(400, 131056), WhatsappRateLimitedError],
    [{ status: 429, body: {} }, WhatsappRateLimitedError],
    [graphError(400, 131047), WhatsappRejectedError],
    [{ status: 503, body: '<html>' }, WhatsappUnavailableError],
  ])('mapeia erro da API (%j)', async (response, ErrorClass) => {
    const { client, fetchMock } = setup([response]);
    await expect(client.sendText({ to: PHONE, text: 'oi' })).rejects.toBeInstanceOf(ErrorClass);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('guarda o código do erro da Graph API', async () => {
    const { client } = setup([graphError(400, 131047)]);
    await expect(client.sendText({ to: PHONE, text: 'oi' })).rejects.toMatchObject({
      code: 131047,
      status: 400,
    });
  });

  it('timeout ou erro de rede vira resultado desconhecido, sem nova tentativa', async () => {
    const timeout = new Error('timeout');
    timeout.name = 'TimeoutError';
    const { client, fetchMock } = setup([timeout, new TypeError('fetch failed')]);

    await expect(client.sendText({ to: PHONE, text: 'oi' })).rejects.toBeInstanceOf(
      WhatsappUnknownOutcomeError,
    );
    await expect(client.sendText({ to: PHONE, text: 'oi' })).rejects.toBeInstanceOf(
      WhatsappUnknownOutcomeError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resposta 200 sem id de mensagem vira WhatsappResponseError', async () => {
    const { client } = setup([{ body: { messages: [] } }]);
    await expect(client.sendText({ to: PHONE, text: 'oi' })).rejects.toBeInstanceOf(
      WhatsappResponseError,
    );
  });

  it('não loga o token, o telefone cru nem o conteúdo', async () => {
    const { client, logger } = setup([ok(), graphError(400, 131047)]);
    await client.sendText({ to: PHONE, text: 'meu cpf é 123' });
    await client.sendText({ to: PHONE, text: 'meu cpf é 123' }).catch(() => undefined);

    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(PHONE);
    expect(logged).not.toContain('cpf');
    expect(logged).toContain('*******1234');
    expect(logged).toContain('131047');
  });
});
