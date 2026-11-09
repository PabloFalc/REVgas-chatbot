import { describe, expect, it } from 'vitest';
import { createChatwootClient } from './chatwoot.factory';
import { FakeChatwootClient } from './fake-chatwoot.client';
import { HttpChatwootClient } from './http-chatwoot.client';
import type { ChatwootConfig } from './shared/chatwoot.config';

const base: ChatwootConfig = {
  mode: 'live',
  baseUrl: 'http://chat.test',
  accountId: 1,
  inboxId: 2,
  apiToken: 'a',
  botToken: 'b',
  webhookSecret: '0123456789abcdef0123',
  timeoutMs: 1000,
};

describe('createChatwootClient', () => {
  it('devolve null em off', () => {
    expect(createChatwootClient({ ...base, mode: 'off' })).toBeNull();
  });

  it('cria o fake', () => {
    expect(createChatwootClient({ ...base, mode: 'fake' })).toBeInstanceOf(FakeChatwootClient);
  });

  it('passa o inboxId ao fake', async () => {
    const client = createChatwootClient({ ...base, mode: 'fake' }) as FakeChatwootClient;
    await client.createContact({ name: 'A', identifier: 'i', phoneNumber: '+1', sourceId: 's' });
    expect((await client.findContact('i'))?.sourceIds).toEqual({ 2: 's' });
  });

  it('cria o cliente real', () => {
    expect(createChatwootClient(base)).toBeInstanceOf(HttpChatwootClient);
  });
});
