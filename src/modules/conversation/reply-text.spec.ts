import { describe, expect, it } from 'vitest';
import type { Reply } from './contracts/conversation.types';
import { replyText } from './reply-text';

describe('replyText', () => {
  it('texto sai como está', () => {
    expect(replyText({ type: 'text', text: 'olá' })).toBe('olá');
  });

  it('botões: corpo e um título entre colchetes por linha', () => {
    const reply: Reply = {
      type: 'buttons',
      body: 'Confirma?',
      buttons: [
        { id: 'yes', title: 'Sim' },
        { id: 'no', title: 'Não' },
      ],
    };
    expect(replyText(reply)).toBe('Confirma?\n[Sim]\n[Não]');
  });

  it('lista: corpo e uma linha por opção, com descrição quando houver', () => {
    const reply: Reply = {
      type: 'list',
      body: 'Escolha',
      buttonText: 'Ver',
      sections: [
        { title: 'A', rows: [{ id: '1', title: 'P13', description: '13 kg' }] },
        { rows: [{ id: '2', title: 'P20' }] },
      ],
    };
    expect(replyText(reply)).toBe('Escolha\n- P13 (13 kg)\n- P20');
  });
});
