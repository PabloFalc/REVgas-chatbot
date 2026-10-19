import z from 'zod';

export const zIsoDatetime = z.preprocess(val => {
  if (val instanceof Date) {
    return val.toISOString();
  }

  return val;
}, z.iso.datetime());
