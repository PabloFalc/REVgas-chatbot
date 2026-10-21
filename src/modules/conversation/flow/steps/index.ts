import {
  asks as customerAsks,
  handlers as customerHandlers,
  start as customerStart,
} from './customer.step';
import { asks, handlers } from './registry';

Object.assign(asks, customerAsks);
Object.assign(handlers, customerHandlers);

export const start = customerStart;

export { asks, handlers };
