import { describe, expect, it } from 'vitest';
import { WhatsappInvalidMessageError } from '../../../core/erros/whatsapp/whatsapp.errors';
import { buttonsPayload, listPayload, readPayload, textPayload } from './messages.payload';

const to = '5586999990000';

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `p${index}`, title: `Produto ${index}` }));

describe('textPayload', () => {
  it('monta o corpo da Cloud API', () => {
    expect(textPayload({ to, text: 'Olá' })).toEqual({
      type: 'text',
      to,
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: 'Olá', preview_url: false },
      },
    });
  });

  it('recusa telefone fora do formato wa_id e texto vazio', () => {
    expect(() => textPayload({ to: '+55 86 99999-0000', text: 'oi' })).toThrow(
      WhatsappInvalidMessageError,
    );
    expect(() => textPayload({ to, text: '' })).toThrow(WhatsappInvalidMessageError);
  });
});

describe('buttonsPayload', () => {
  it('monta botões de resposta com header e footer', () => {
    const payload = buttonsPayload({
      to,
      header: 'Endereço',
      body: 'Entregar no endereço salvo?',
      footer: 'RevGás',
      buttons: [
        { id: 'sim', title: 'Sim' },
        { id: 'alterar', title: 'Alterar endereço' },
      ],
    });
    expect(payload.body.interactive).toEqual({
      type: 'button',
      header: { type: 'text', text: 'Endereço' },
      body: { text: 'Entregar no endereço salvo?' },
      footer: { text: 'RevGás' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'sim', title: 'Sim' } },
          { type: 'reply', reply: { id: 'alterar', title: 'Alterar endereço' } },
        ],
      },
    });
  });

  it('recusa mais de 3 botões, título com mais de 20 caracteres e ids repetidos', () => {
    const button = { id: 'a', title: 'A' };
    expect(() =>
      buttonsPayload({
        to,
        body: 'x',
        buttons: [button, { ...button, id: 'b' }, { ...button, id: 'c' }, { ...button, id: 'd' }],
      }),
    ).toThrow(WhatsappInvalidMessageError);
    expect(() =>
      buttonsPayload({ to, body: 'x', buttons: [{ id: 'a', title: 'x'.repeat(21) }] }),
    ).toThrow(WhatsappInvalidMessageError);
    expect(() => buttonsPayload({ to, body: 'x', buttons: [button, button] })).toThrow(
      WhatsappInvalidMessageError,
    );
  });

  it('expõe os problemas encontrados no erro', () => {
    try {
      buttonsPayload({ to, body: 'x', buttons: [] });
      expect.unreachable();
    } catch (error) {
      expect((error as WhatsappInvalidMessageError).issues[0].path).toBe('buttons');
    }
  });
});

describe('listPayload', () => {
  it('monta a lista sem campos opcionais vazios', () => {
    const payload = listPayload({
      to,
      body: 'Escolha o produto',
      buttonText: 'Ver produtos',
      sections: [{ rows: [{ id: 'p13', title: 'Botijão P13', description: 'Gás de cozinha' }] }],
    });
    expect(payload.body.interactive).toEqual({
      type: 'list',
      body: { text: 'Escolha o produto' },
      action: {
        button: 'Ver produtos',
        sections: [{ rows: [{ id: 'p13', title: 'Botijão P13', description: 'Gás de cozinha' }] }],
      },
    });
  });

  it('aceita 10 opções e recusa 11 somando as seções', () => {
    expect(() =>
      listPayload({ to, body: 'x', buttonText: 'Ver', sections: [{ rows: rows(10) }] }),
    ).not.toThrow();
    expect(() =>
      listPayload({
        to,
        body: 'x',
        buttonText: 'Ver',
        sections: [
          { title: 'Gás', rows: rows(6) },
          { title: 'Água', rows: rows(5).map(row => ({ ...row, id: `a${row.id}` })) },
        ],
      }),
    ).toThrow(WhatsappInvalidMessageError);
  });

  it('exige título em todas as seções quando há mais de uma', () => {
    expect(() =>
      listPayload({
        to,
        body: 'x',
        buttonText: 'Ver',
        sections: [
          { rows: [{ id: 'a', title: 'A' }] },
          { title: 'B', rows: [{ id: 'b', title: 'B' }] },
        ],
      }),
    ).toThrow(WhatsappInvalidMessageError);
  });
});

describe('readPayload', () => {
  it('marca a mensagem como lida', () => {
    expect(readPayload('wamid.1')).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.1',
    });
  });
});
