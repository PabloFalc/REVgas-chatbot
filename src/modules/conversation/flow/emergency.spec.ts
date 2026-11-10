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
  ])('detecta "%s"', value => {
    expect(detectEmergency(value)).toBe(true);
  });

  it.each([
    'o gás acabou',
    'gás de cozinha',
    'vazio',
    'meu botijão está vazio',
    'quero um botijão',
    'Maria da Silva',
  ])('não dispara em "%s"', value => {
    expect(detectEmergency(value)).toBe(false);
  });
});
