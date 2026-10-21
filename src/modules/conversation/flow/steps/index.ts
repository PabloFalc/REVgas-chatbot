import { asks as addressAsks, handlers as addressHandlers } from './address.step';
import {
  asks as customerAsks,
  handlers as customerHandlers,
  start as customerStart,
} from './customer.step';
import { asks, handlers } from './registry';

Object.assign(asks, customerAsks, addressAsks);
Object.assign(handlers, customerHandlers, addressHandlers);

export const start = customerStart;

export { asks, handlers };
