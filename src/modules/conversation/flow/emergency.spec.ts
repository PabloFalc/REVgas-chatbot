import { describe, expect, it } from 'vitest';
import { detectEmergency } from './emergency';

describe('detectEmergency', () => {
  it.each([
    'vazamento',
    'VAZAMENTO DE GÁS',
    'o botijão vaza',
    'acho que está vazando aqui',
    'sinto cheiro de gás na cozinha',
    'Cheiro de gas!',
    'tá cheirando a gás',
    'tem fedor de gas',
    'tem gás escapando',
    'ta escapando gas',
    'o botijao vazou ontem',
    'tá saindo gás',
    'saindo gas',
    'o gás está escapando',
    'o gás escapou',
    'cheiro do gás',
    'sentindo cheiro de gás',
    'um cheiro forte no gás',
    'cheiro de GLP',
    'cheiro de gaz',
    'vazamentos na cozinha',
    'vasamento',
    'vazamneto',
    'o botijão tá cheirando',
  ])('detecta "%s"', value => {
    expect(detectEmergency(value)).toBe(true);
  });

  it.each([
    'o gás acabou',
    'gás de cozinha',
    'vazio',
    'meu botijão está vazio',
    'quero um botijão',
    'quero gás de cozinha',
    'botijão vazio',
    'troca do casco vazio',
    'quero 2 botijões',
    'gás P13 por favor',
    'Maria da Silva',
  ])('não dispara em "%s"', value => {
    expect(detectEmergency(value)).toBe(false);
  });
});
