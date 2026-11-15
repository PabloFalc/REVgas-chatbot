import { describe, expect, it } from 'vitest';
import {
  buttonsPayload,
  listPayload,
  textPayload,
} from '../../integrations/whatsapp/messages/messages.payload';
import { renderMessage } from './chat.render';

const TO = '5586999990000';

describe('renderMessage', () => {
  it('mostra texto com o prefixo do bot e recua as linhas seguintes', () => {
    const rendered = renderMessage(textPayload({ to: TO, text: 'Olá!\nQual o seu CEP?' }).body);
    expect(rendered.lines).toEqual(['bot › Olá!', '      Qual o seu CEP?']);
    expect(rendered.options).toBeNull();
  });

  it('numera os botões e guarda id e título de cada um', () => {
    const rendered = renderMessage(
      buttonsPayload({
        to: TO,
        body: 'Confere o pedido?',
        buttons: [
          { id: 'confirm', title: 'Confirmar' },
          { id: 'fix', title: 'Corrigir' },
        ],
      }).body,
    );
    expect(rendered.lines).toEqual([
      'bot › Confere o pedido?',
      '      [1] Confirmar  [2] Corrigir',
    ]);
    expect(rendered.options).toEqual([
      { kind: 'button', id: 'confirm', title: 'Confirmar' },
      { kind: 'button', id: 'fix', title: 'Corrigir' },
    ]);
  });

  it('mostra cabeçalho e rodapé quando existem', () => {
    const rendered = renderMessage(
      buttonsPayload({
        to: TO,
        header: 'Resumo',
        body: 'Tudo certo?',
        footer: 'Responda em 15 min',
        buttons: [{ id: 'ok', title: 'Sim' }],
      }).body,
    );
    expect(rendered.lines).toEqual([
      'bot › *Resumo*',
      '      Tudo certo?',
      '      (Responda em 15 min)',
      '      [1] Sim',
    ]);
  });

  it('numera os itens da lista em sequência, com seções e descrições', () => {
    const rendered = renderMessage(
      listPayload({
        to: TO,
        body: 'Escolha o produto',
        buttonText: 'Ver produtos',
        sections: [
          {
            title: 'Botijões',
            rows: [
              { id: 'p:1', title: 'P13', description: 'R$ 110,00' },
              { id: 'p:2', title: 'P45' },
            ],
          },
          { title: 'Água', rows: [{ id: 'p:3', title: 'Galão 20L' }] },
        ],
      }).body,
    );
    expect(rendered.lines).toEqual([
      'bot › Escolha o produto',
      '      ≡ Ver produtos',
      '      Botijões',
      '        [1] P13 — R$ 110,00',
      '        [2] P45',
      '      Água',
      '        [3] Galão 20L',
    ]);
    expect(rendered.options).toEqual([
      { kind: 'list', id: 'p:1', title: 'P13' },
      { kind: 'list', id: 'p:2', title: 'P45' },
      { kind: 'list', id: 'p:3', title: 'Galão 20L' },
    ]);
  });

  it('lista sem título de seção não mostra cabeçalho de seção', () => {
    const rendered = renderMessage(
      listPayload({
        to: TO,
        body: 'Pagamento',
        buttonText: 'Formas',
        sections: [{ rows: [{ id: 'pay:1', title: 'Pix' }] }],
      }).body,
    );
    expect(rendered.lines).toEqual(['bot › Pagamento', '      ≡ Formas', '        [1] Pix']);
  });

  it('mensagem que não reconhece vira aviso, sem opções', () => {
    const rendered = renderMessage({ type: 'image' });
    expect(rendered.lines).toEqual(['bot › [mensagem do tipo image]']);
    expect(rendered.options).toBeNull();
  });
});
