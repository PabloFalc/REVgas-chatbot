import { describe, expect, it } from 'vitest';
import { parseWebhook } from '../../integrations/whatsapp/webhook/webhook.parser';
import { inboundPayload, parseLine } from './chat.input';
import type { MenuOption } from './chat.render';

const MENU: MenuOption[] = [
  { kind: 'button', id: 'confirm', title: 'Confirmar' },
  { kind: 'button', id: 'fix', title: 'Corrigir' },
];

describe('parseLine', () => {
  it('linha em branco não envia nada', () => {
    expect(parseLine('   ', MENU)).toEqual({ kind: 'empty' });
  });

  it('número dentro do menu vira a opção escolhida', () => {
    expect(parseLine(' 2 ', MENU)).toEqual({ kind: 'choice', option: MENU[1] });
  });

  it('número fora do menu ou sem menu vai como texto', () => {
    expect(parseLine('3', MENU)).toEqual({ kind: 'text', text: '3' });
    expect(parseLine('0', MENU)).toEqual({ kind: 'text', text: '0' });
    expect(parseLine('1', null)).toEqual({ kind: 'text', text: '1' });
    expect(parseLine('64000000', MENU)).toEqual({ kind: 'text', text: '64000000' });
  });

  it('texto livre vai como texto', () => {
    expect(parseLine('quero 2 botijões', MENU)).toEqual({
      kind: 'text',
      text: 'quero 2 botijões',
    });
  });

  it('reconhece /sair, /novo e /ajuda, sem diferenciar maiúsculas', () => {
    expect(parseLine('/sair', MENU)).toEqual({ kind: 'command', command: 'sair' });
    expect(parseLine('/NOVO', MENU)).toEqual({ kind: 'command', command: 'novo' });
    expect(parseLine('/ajuda', null)).toEqual({ kind: 'command', command: 'ajuda' });
  });

  it('/texto força o envio como texto, mesmo sendo número do menu', () => {
    expect(parseLine('/texto 1', MENU)).toEqual({ kind: 'text', text: '1' });
    expect(parseLine('/texto', MENU)).toEqual({ kind: 'empty' });
  });

  it('comando desconhecido é apontado', () => {
    expect(parseLine('/voltar', MENU)).toEqual({ kind: 'unknown', command: '/voltar' });
  });
});

describe('inboundPayload', () => {
  const base = {
    phone: '5586999990000',
    name: 'Cliente Simulador',
    phoneNumberId: '100000000000000',
    messageId: 'wamid.chat.1',
  };

  it('texto vira evento de texto do webhook, com nome e número da caixa', () => {
    const events = parseWebhook(inboundPayload({ ...base, input: { kind: 'text', text: 'oi' } }));
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'message',
        id: 'wamid.chat.1',
        from: '5586999990000',
        name: 'Cliente Simulador',
        phoneNumberId: '100000000000000',
        content: { type: 'text', text: 'oi' },
      }),
    ]);
  });

  it('botão vira button_reply com id e título', () => {
    const payload = inboundPayload({ ...base, input: { kind: 'choice', option: MENU[0] } });
    const message = (payload.entry[0].changes[0].value.messages as unknown[])[0];
    expect(message).toMatchObject({
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'confirm', title: 'Confirmar' } },
    });
    expect(parseWebhook(payload)[0]).toMatchObject({
      content: { type: 'reply', replyId: 'confirm', title: 'Confirmar' },
    });
  });

  it('item de lista vira list_reply com id e título', () => {
    const option: MenuOption = { kind: 'list', id: 'p:1', title: 'P13' };
    const payload = inboundPayload({ ...base, input: { kind: 'choice', option } });
    const message = (payload.entry[0].changes[0].value.messages as unknown[])[0];
    expect(message).toMatchObject({
      interactive: { type: 'list_reply', list_reply: { id: 'p:1', title: 'P13' } },
    });
    expect(parseWebhook(payload)[0]).toMatchObject({
      content: { type: 'reply', replyId: 'p:1', title: 'P13' },
    });
  });
});
