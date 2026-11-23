const WITH_OFFSET = /(Z|[+-]\d{2}(:?\d{2})?)$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

export const parseBrasiliaTimestamp = (date: string | null | undefined): number => {
  if (!date || !DATE_TIME.test(date)) return Number.NaN;
  const iso = date.replace(' ', 'T');
  return Date.parse(WITH_OFFSET.test(iso) ? iso : `${iso}-03:00`);
};
