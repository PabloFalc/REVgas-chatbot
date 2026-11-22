import { describe, expect, it, vi } from 'vitest';
import { ChatwootError } from '../../core/erros/chatwoot/chatwoot.errors';
import { HttpChatwootClient } from './http-chatwoot.client';

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const make = (fetchMock: unknown, logger = { info: vi.fn(), warn: vi.fn() }) =>
  new HttpChatwootClient({
    baseUrl: 'http://chat.test',
    accountId: 1,
    inboxId: 2,
    apiToken: 'api-token',
    botToken: 'bot-token',
    timeoutMs: 1000,
    logger,
    fetch: fetchMock as typeof fetch,
  });

const root = 'http://chat.test/api/v1/accounts/1';

const headerOf = (mock: ReturnType<typeof vi.fn>, call = 0) =>
  (mock.mock.calls[call][1].headers as Record<string, string>).api_access_token;

describe('HttpChatwootClient', () => {
  it('findContact busca com o api token e exige identifier exato', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        payload: [
          { id: 1, identifier: '55869999912345', contact_inboxes: [] },
          {
            id: 2,
            identifier: '5586999991234',
            contact_inboxes: [{ source_id: 'src', inbox: { id: 2 } }],
          },
        ],
      }),
    );
    const contact = await make(fetchMock).findContact('5586999991234');

    expect(fetchMock.mock.calls[0][0]).toBe(`${root}/contacts/search?q=5586999991234`);
    expect(headerOf(fetchMock)).toBe('api-token');
    expect(contact).toEqual({ id: 2, identifier: '5586999991234', sourceIds: { 2: 'src' } });
  });

  it('findContact ignora resultado com identifier diferente', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ payload: [{ id: 1, identifier: '55869999912345', contact_inboxes: [] }] }),
      );
    expect(await make(fetchMock).findContact('5586999991234')).toBeNull();
  });

  it('createContact usa o api token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ payload: { contact: { id: 7 }, contact_inbox: { source_id: 's7' } } }),
      );
    const result = await make(fetchMock).createContact({
      name: 'Ana',
      identifier: '5586999991234',
      phoneNumber: '+5586999991234',
      sourceId: 's7',
    });

    expect(fetchMock.mock.calls[0][0]).toBe(`${root}/contacts`);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(headerOf(fetchMock)).toBe('api-token');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      inbox_id: 2,
      name: 'Ana',
      identifier: '5586999991234',
      phone_number: '+5586999991234',
      source_id: 's7',
    });
    expect(result).toEqual({ contactId: 7, sourceId: 's7' });
  });

  it('createContactInbox usa o api token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ source_id: 'x' }));
    const result = await make(fetchMock).createContactInbox(7, 'x');

    expect(fetchMock.mock.calls[0][0]).toBe(`${root}/contacts/7/contact_inboxes`);
    expect(headerOf(fetchMock)).toBe('api-token');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ inbox_id: 2, source_id: 'x' });
    expect(result).toEqual({ sourceId: 'x' });
  });

  it('createConversation usa o bot token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 11 }));
    const result = await make(fetchMock).createConversation({
      contactId: 7,
      sourceId: 'x',
      status: 'pending',
    });

    expect(fetchMock.mock.calls[0][0]).toBe(`${root}/conversations`);
    expect(headerOf(fetchMock)).toBe('bot-token');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      source_id: 'x',
      inbox_id: 2,
      contact_id: 7,
      status: 'pending',
    });
    expect(result).toEqual({ id: 11 });
  });

  it('createMessage usa o bot token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 21 }));
    const result = await make(fetchMock).createMessage(11, {
      content: 'oi',
      type: 'incoming',
      private: true,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(`${root}/conversations/11/messages`);
    expect(headerOf(fetchMock)).toBe('bot-token');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      content: 'oi',
      message_type: 'incoming',
      private: true,
    });
    expect(result).toEqual({ id: 21 });
  });

  it('setStatus usa o bot token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ payload: {} }));
    await make(fetchMock).setStatus(11, 'open');

    expect(fetchMock.mock.calls[0][0]).toBe(`${root}/conversations/11/toggle_status`);
    expect(headerOf(fetchMock)).toBe('bot-token');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: 'open' });
  });

  it('500 em POST vira unavailable sem repetir', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('x', { status: 500 }));
    await expect(
      make(fetchMock).createMessage(1, { content: 'a', type: 'incoming' }),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rede em POST vira unknown_outcome', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      make(fetchMock).createMessage(1, { content: 'a', type: 'incoming' }),
    ).rejects.toMatchObject({ kind: 'unknown_outcome' });
  });

  it('rede e timeout em GET viram unavailable', async () => {
    const network = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(make(network).findContact('1')).rejects.toMatchObject({ kind: 'unavailable' });
    const timeout = vi.fn().mockRejectedValue(new DOMException('t', 'TimeoutError'));
    await expect(make(timeout).findContact('1')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('401 vira unauthorized', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('no', { status: 401 }));
    const error = await make(fetchMock)
      .findContact('1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatwootError);
    expect(error).toMatchObject({ kind: 'unauthorized', status: 401 });
  });

  it('resposta sem id vira response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ foo: 1 }));
    await expect(
      make(fetchMock).createConversation({ contactId: 1, sourceId: 'x', status: 'pending' }),
    ).rejects.toMatchObject({ kind: 'response' });
  });

  it('o log não contém tokens nem conteúdo', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }));
    await make(fetchMock, logger).createMessage(1, {
      content: 'segredo-do-cliente',
      type: 'incoming',
    });
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain('bot-token');
    expect(logged).not.toContain('segredo-do-cliente');
    expect(logger.info.mock.calls[0][0]).toMatchObject({ component: 'chatwoot', status: 200 });
  });
});
