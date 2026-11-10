import { FakeChatwootClient } from 'src/integrations/chatwoot/fake-chatwoot.client';
import { describe, expect, it, vi } from 'vitest';
import { DeskGateway } from './desk.gateway';

function setup() {
  const client = new FakeChatwootClient({ inboxId: 1 });
  const gateway = new DeskGateway(client, { mode: 'fake', baseUrl: '', timeoutMs: 1, inboxId: 1 });
  return { client, gateway };
}

describe('DeskGateway', () => {
  it('cria contato novo com identifier e telefone com +', async () => {
    const { client, gateway } = setup();
    const spy = vi.spyOn(client, 'createContact');
    const contact = await gateway.ensureContact('5585999990000', 'Maria', null);
    expect(spy).toHaveBeenCalledWith({
      name: 'Maria',
      identifier: '5585999990000',
      phoneNumber: '+5585999990000',
      sourceId: '5585999990000',
    });
    expect(contact.sourceId).toBe('5585999990000');
  });

  it('oculta CPF no nome do contato', async () => {
    const { client, gateway } = setup();
    const spy = vi.spyOn(client, 'createContact');
    await gateway.ensureContact('5585999990000', 'Maria 123.456.789-09', null);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'Maria [CPF ocultado]' }));
  });

  it('usa o telefone como nome quando não há nome', async () => {
    const { client, gateway } = setup();
    const spy = vi.spyOn(client, 'createContact');
    await gateway.ensureContact('5585999990000', undefined, null);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: '5585999990000' }));
  });

  it('contato existente sem a caixa ganha contact_inbox', async () => {
    const { client, gateway } = setup();
    client.contacts.push({ id: 77, identifier: '5585999990000', sourceIds: {} });
    const spy = vi.spyOn(client, 'createContactInbox');
    const contact = await gateway.ensureContact('5585999990000', 'Maria', null);
    expect(spy).toHaveBeenCalledWith(77, '5585999990000');
    expect(contact.contactId).toBe(77);
  });

  it('contato existente com a caixa é reaproveitado', async () => {
    const { client, gateway } = setup();
    client.contacts.push({ id: 78, identifier: '5585999990000', sourceIds: { 1: 'abc' } });
    const create = vi.spyOn(client, 'createContact');
    const inbox = vi.spyOn(client, 'createContactInbox');
    await expect(gateway.ensureContact('5585999990000', 'Maria', null)).resolves.toEqual({
      contactId: 78,
      sourceId: 'abc',
    });
    expect(create).not.toHaveBeenCalled();
    expect(inbox).not.toHaveBeenCalled();
  });

  it('cached não chama o cliente', async () => {
    const { client, gateway } = setup();
    const find = vi.spyOn(client, 'findContact');
    const cached = { contactId: 3, sourceId: 's' };
    await expect(gateway.ensureContact('5585999990000', 'Maria', cached)).resolves.toBe(cached);
    expect(find).not.toHaveBeenCalled();
  });

  it('openConversation cria pending', async () => {
    const { client, gateway } = setup();
    const id = await gateway.openConversation({ contactId: 3, sourceId: 's' });
    expect(client.conversations.get(id)?.status).toBe('pending');
  });

  it('posta mensagens, notas e muda o status', async () => {
    const { client, gateway } = setup();
    const id = await gateway.openConversation({ contactId: 3, sourceId: 's' });
    await gateway.postIncoming(id, 'oi');
    await gateway.postOutgoing(id, 'olá');
    await gateway.postNote(id, 'nota');
    await gateway.setStatus(id, 'open');
    const conversation = client.conversations.get(id);
    expect(conversation?.messages.map(m => [m.content, m.type, m.private])).toEqual([
      ['oi', 'incoming', false],
      ['olá', 'outgoing', false],
      ['nota', 'outgoing', true],
    ]);
    expect(conversation?.status).toBe('open');
  });

  it('enabled é false com cliente nulo', () => {
    const gateway = new DeskGateway(null, { mode: 'off', baseUrl: '', timeoutMs: 1 });
    expect(gateway.enabled).toBe(false);
    expect(setup().gateway.enabled).toBe(true);
  });
});
