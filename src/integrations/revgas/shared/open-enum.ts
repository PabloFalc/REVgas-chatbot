import { z } from 'zod';

export const openEnum = <const T extends readonly string[]>(_values: T) =>
  z.string().transform(value => value as T[number] | (string & {}));
