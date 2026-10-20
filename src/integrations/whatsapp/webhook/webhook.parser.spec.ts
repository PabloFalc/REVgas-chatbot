import { describe, expect, it } from 'vitest';
import { webhookPayload } from '../testing/webhook.testing';
import { parseWebhook } from './webhook.parser';

describe('parseWebhook', () => {
  it('lê mensagem de texto com nome do contato e timestamp', () => {
    const events = parseWebhook(
      webhookPayload({
        messages: [
          {
            from: '5586999991234',
            id: 'wamid.1',
            timestamp: '1760000000',
            type: 'text',
            text: { body: 'oi' },
          },
        ],
      }),
    );
    expect(events).toEqual([
      {
        kind: 'message',
        id: 'wamid.1',
        from: '5586999991234',
        name: 'Cliente Teste',
        timestamp: 1760000000,
        phoneNumberId: '1122334455',
        content: { type: 'text', text: 'oi' },
      },
    ]);
  });

  it('lê resposta de botão, de lista e de botão de template', () => {
    const events = parseWebhook(
      webhookPayload({
        messages: [
          {
            from: '5586999991234',
            id: 'wamid.2',
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: 'sim', title: 'Sim' } },
          },
          {
            from: '5586999991234',
            id: 'wamid.3',
            type: 'interactive',
            interactive: { type: 'list_reply', list_reply: { id: 'p13', title: 'P13' } },
          },
          {
            from: '5586999991234',
            id: 'wamid.4',
            type: 'button',
            button: { payload: 'repetir', text: 'Repetir pedido' },
          },
        ],
      }),
    );
    expect(events.map(event => event.kind === 'message' && event.content)).toEqual([
      { type: 'reply', replyId: 'sim', title: 'Sim' },
      { type: 'reply', replyId: 'p13', title: 'P13' },
      { type: 'reply', replyId: 'repetir', title: 'Repetir pedido' },
    ]);
  });

  it('marca tipos que o bot não trata como unsupported', () => {
    const [event] = parseWebhook(
      webhookPayload({
        messages: [{ from: '5586999991234', id: 'wamid.5', type: 'audio', audio: { id: 'm' } }],
      }),
    );
    expect(event).toMatchObject({ content: { type: 'unsupported', originalType: 'audio' } });
  });

  it('lê status de entrega com códigos de erro', () => {
    const [event] = parseWebhook(
      webhookPayload({
        statuses: [
          {
            id: 'wamid.OUT',
            status: 'failed',
            recipient_id: '5586999991234',
            errors: [{ code: 131047, title: 'Re-engagement message' }],
          },
        ],
      }),
    );
    expect(event).toEqual({
      kind: 'status',
      id: 'wamid.OUT',
      status: 'failed',
      recipient: '5586999991234',
      phoneNumberId: '1122334455',
      errorCodes: [131047],
    });
  });

  it('ignora payloads de outro objeto, campos diferentes de messages e itens inválidos', () => {
    expect(parseWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(parseWebhook('lixo')).toEqual([]);
    expect(
      parseWebhook({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ field: 'account_update', value: {} }] }],
      }),
    ).toEqual([]);
    expect(parseWebhook(webhookPayload({ messages: [{ type: 'text' }], statuses: [{}] }))).toEqual(
      [],
    );
  });
});
