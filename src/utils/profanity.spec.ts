import { describe, expect, it } from 'vitest';
import { hasProfanity } from './profanity';

describe('hasProfanity', () => {
  it.each([
    'vai te fuder filho da puta',
    'cono viado',
    'PORRA',
    'que merda',
    'caralho',
    'vai se foder',
    'foda-se',
    'fdp',
    'vtnc',
    'pqp',
    'vai tomar no cu',
    'seu arrombado',
    'desgraça',
    'desgraçado',
    'porraaaa',
    'p0rra',
    'c@ralho',
    'putas',
    'Puta!',
    'é um bosta',
    'babaca',
    'cuzão',
  ])('"%s" tem palavrão', value => {
    expect(hasProfanity(value)).toBe(true);
  });

  it.each([
    'João Cunha',
    'Maria Puttini',
    'Rua Fodor, 120',
    'Ana Cecília Cuba',
    'computador',
    'disputa',
    'escuta',
    'cuidado com o botijão',
    'Curitiba',
    'Cuiabá',
    'Mocambinho',
    'São Cristóvão',
    'Jóquei',
    'Fátima',
    'Ilhotas',
    'Dirceu',
    'Centro',
    'Rua Pica-Pau Amarelo',
    'Piranhas',
    'quero 2 botijões P13',
    'Rua Desembargador Freitas, 13',
    'vi o veado no mato',
    'fds tô em casa',
    '',
  ])('"%s" não tem palavrão', value => {
    expect(hasProfanity(value)).toBe(false);
  });
});
