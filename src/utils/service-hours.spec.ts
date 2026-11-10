import { describe, expect, it } from 'vitest';
import { isOpenAt, nextOpening, parseServiceHours } from './service-hours';

const hours = 'seg-sex 08:00-18:00; sab 08:00-12:00';

describe('parseServiceHours', () => {
  it('expande intervalos de dias em janelas', () => {
    const windows = parseServiceHours(hours);
    expect(windows).toHaveLength(6);
    expect(windows).toContainEqual({ day: 1, start: 480, end: 1080 });
    expect(windows).toContainEqual({ day: 6, start: 480, end: 720 });
  });

  it('aceita acento, maiúsculas, lista de dias e fim 24:00', () => {
    expect(parseServiceHours('SÁB 08:00-12:00')).toEqual([{ day: 6, start: 480, end: 720 }]);
    expect(parseServiceHours('seg,qua 09:00-10:30')).toEqual([
      { day: 1, start: 540, end: 630 },
      { day: 3, start: 540, end: 630 },
    ]);
    expect(parseServiceHours('dom 20:00-24:00')).toEqual([{ day: 0, start: 1200, end: 1440 }]);
  });

  it('vazio resulta em lista vazia', () => {
    expect(parseServiceHours('')).toEqual([]);
  });

  it.each(['seg 18:00-08:00', 'xyz 08:00-12:00', 'seg 8-12', 'seg'])('lança para %s', text => {
    expect(() => parseServiceHours(text)).toThrow(Error);
  });
});

describe('isOpenAt', () => {
  const windows = parseServiceHours(hours);

  it('aberto dentro da janela', () => {
    expect(isOpenAt(windows, new Date('2026-11-09T10:00:00-03:00'))).toBe(true);
  });

  it('fim é exclusivo', () => {
    expect(isOpenAt(windows, new Date('2026-11-09T18:00:00-03:00'))).toBe(false);
  });

  it('fechado no domingo', () => {
    expect(isOpenAt(windows, new Date('2026-11-08T10:00:00-03:00'))).toBe(false);
  });

  it('sem janelas, sempre aberto', () => {
    expect(isOpenAt([], new Date('2026-11-08T03:00:00-03:00'))).toBe(true);
  });
});

describe('nextOpening', () => {
  const windows = parseServiceHours(hours);

  it('domingo aponta para segunda', () => {
    expect(nextOpening(windows, new Date('2026-11-08T10:00:00-03:00'))).toEqual({
      weekday: 1,
      time: '08:00',
      inDays: 1,
    });
  });

  it('sábado à tarde aponta para segunda', () => {
    expect(nextOpening(windows, new Date('2026-11-14T13:00:00-03:00'))).toEqual({
      weekday: 1,
      time: '08:00',
      inDays: 2,
    });
  });

  it('antes da abertura aponta para hoje', () => {
    expect(nextOpening(windows, new Date('2026-11-09T06:00:00-03:00'))).toEqual({
      weekday: 1,
      time: '08:00',
      inDays: 0,
    });
  });

  it('o mesmo instante em UTC dá o mesmo resultado', () => {
    expect(nextOpening(windows, new Date('2026-11-09T09:00:00Z'))).toEqual({
      weekday: 1,
      time: '08:00',
      inDays: 0,
    });
  });

  it('sem janelas retorna null', () => {
    expect(nextOpening([], new Date())).toBeNull();
  });
});
