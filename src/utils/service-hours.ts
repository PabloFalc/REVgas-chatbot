export const SERVICE_TIME_ZONE = 'America/Fortaleza';

export interface ServiceWindow {
  day: number;
  start: number;
  end: number;
}

export interface Opening {
  weekday: number;
  time: string;
  inDays: number;
}

const DAY_NAMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const ENGLISH_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ENTRY_PATTERN = /^(\S+)\s+(\d{2}):(\d{2})-(\d{2}):(\d{2})$/;

function dayIndex(name: string): number {
  const normalized = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  const index = DAY_NAMES.indexOf(normalized);
  if (index === -1) throw new Error(`Dia inválido no horário de atendimento: "${name}"`);
  return index;
}

function parseDays(spec: string): number[] {
  if (spec.includes('-')) {
    const [from, to, ...rest] = spec.split('-');
    if (!from || !to || rest.length > 0) {
      throw new Error(`Intervalo de dias inválido: "${spec}"`);
    }
    const first = dayIndex(from);
    const last = dayIndex(to);
    if (first > last) throw new Error(`Intervalo de dias inválido: "${spec}"`);
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  }
  return spec.split(',').map(dayIndex);
}

function toMinutes(hours: string, minutes: string, allowEndOfDay: boolean): number {
  const h = Number(hours);
  const m = Number(minutes);
  const total = h * 60 + m;
  const valid = m < 60 && (h < 24 || (allowEndOfDay && h === 24 && m === 0));
  if (!valid) throw new Error(`Horário inválido: "${hours}:${minutes}"`);
  return total;
}

export function parseServiceHours(text: string): ServiceWindow[] {
  const windows: ServiceWindow[] = [];
  for (const raw of text.split(';')) {
    const entry = raw.trim();
    if (entry === '') continue;
    const match = ENTRY_PATTERN.exec(entry);
    if (!match) {
      throw new Error(`Entrada inválida no horário de atendimento: "${entry}"`);
    }
    const [, daySpec, startH, startM, endH, endM] = match as unknown as string[];
    const start = toMinutes(startH, startM, false);
    const end = toMinutes(endH, endM, true);
    if (end <= start) {
      throw new Error(`O fim deve ser depois do início: "${entry}"`);
    }
    for (const day of parseDays(daySpec)) {
      windows.push({ day, start, end });
    }
  }
  return windows;
}

function localParts(date: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return {
    weekday: ENGLISH_WEEKDAYS.indexOf(pick('weekday')),
    minutes: Number(pick('hour')) * 60 + Number(pick('minute')),
  };
}

export function isOpenAt(
  windows: ServiceWindow[],
  date: Date,
  timeZone: string = SERVICE_TIME_ZONE,
): boolean {
  if (windows.length === 0) return true;
  const { weekday, minutes } = localParts(date, timeZone);
  return windows.some(
    window => window.day === weekday && minutes >= window.start && minutes < window.end,
  );
}

function formatTime(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export function nextOpening(
  windows: ServiceWindow[],
  date: Date,
  timeZone: string = SERVICE_TIME_ZONE,
): Opening | null {
  if (windows.length === 0) return null;
  const { weekday, minutes } = localParts(date, timeZone);
  for (let inDays = 0; inDays <= 7; inDays++) {
    const day = (weekday + inDays) % 7;
    const starts = windows
      .filter(window => window.day === day && (inDays > 0 || window.start > minutes))
      .map(window => window.start);
    if (starts.length > 0) {
      return { weekday: day, time: formatTime(Math.min(...starts)), inDays };
    }
  }
  return null;
}
