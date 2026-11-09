import { describe, expect, it } from 'vitest';
import { ChatwootError } from '../../core/erros/chatwoot/chatwoot.errors';
import { FakeChatwootClient } from './fake-chatwoot.client';

describe('FakeChatwootClient', () => {
  it('cria contato, conversa pending, mensagens e muda o status', async () => {
    const client = new FakeChatwootClient();
    expect(await client.findContact('5586999991234')).toBeNull();

    const created = await client.createContact({
      name: 'Ana',
      identifier: '5586999991234',
      phoneNumber: '+5586999991234',
      sourceId: 'src-1',
    });
    const found = await client.findContact('5586999991234');
    expect(found?.id).toBe(created.contactId);

    const conversation = await client.createConversation({
      contactId: created.contactId,
      sourceId: created.sourceId,
      status: 'pending',
    });
    const message = await client.createMessage(conversation.id, {
      content: 'oi',
      type: 'incoming',
    });
    await client.setStatus(conversation.id, 'open');

    const stored = client.conversations.get(conversation.id);
    expect(stored?.status).toBe('open');
    expect(stored?.messages).toEqual([
      { id: message.id, content: 'oi', type: 'incoming', private: false },
    ]);
  });

  it('failNext afeta só a próxima chamada', async () => {
    const client = new FakeChatwootClient();
    client.failNext();
    await expect(client.findContact('1')).rejects.toBeInstanceOf(ChatwootError);
    await expect(client.findContact('1')).resolves.toBeNull();
  });

  it('clear limpa o estado', async () => {
    const client = new FakeChatwootClient();
    await client.createContact({ name: 'A', identifier: '1', phoneNumber: '+1', sourceId: 's' });
    client.clear();
    expect(client.contacts).toHaveLength(0);
  });
});
