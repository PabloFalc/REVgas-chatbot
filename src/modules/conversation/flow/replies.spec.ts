import { describe, expect, it } from 'vitest';
import { buttons, list, text } from './replies';

describe('corpo das respostas', () => {
  it.each([4095, 4096, 4097])('limita texto de %i caracteres', length => {
    const body = 'a'.repeat(length);
    const reply = text(body);
    expect(reply).toEqual({
      type: 'text',
      text: length > 4096 ? `${'a'.repeat(4095)}…` : body,
    });
  });

  it.each([1023, 1024, 1025])('limita botões de %i caracteres', length => {
    const body = 'a'.repeat(length);
    const reply = buttons(body, [{ id: 'yes', title: 'Sim' }]);
    expect(reply).toEqual({
      type: 'buttons',
      body: length > 1024 ? `${'a'.repeat(1023)}…` : body,
      buttons: [{ id: 'yes', title: 'Sim' }],
    });
  });

  it.each([1023, 1024, 1025])('limita lista de %i caracteres', length => {
    const body = 'a'.repeat(length);
    const reply = list(body, 'Ver produtos', [{ id: 'product:1', title: 'Botijão P13' }]);
    expect(reply).toEqual({
      type: 'list',
      body: length > 1024 ? `${'a'.repeat(1023)}…` : body,
      buttonText: 'Ver produtos',
      sections: [{ rows: [{ id: 'product:1', title: 'Botijão P13' }] }],
    });
  });
});
