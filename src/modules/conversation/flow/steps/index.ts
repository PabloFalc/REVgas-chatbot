import { asks as addressAsks, handlers as addressHandlers } from './address.step';
import {
  asks as customerAsks,
  handlers as customerHandlers,
  start as customerStart,
} from './customer.step';
import { asks as paymentAsks, handlers as paymentHandlers } from './payment.step';
import { asks as productAsks, handlers as productHandlers } from './product.step';
import { asks, handlers } from './registry';

Object.assign(asks, customerAsks, addressAsks, productAsks, paymentAsks);
Object.assign(handlers, customerHandlers, addressHandlers, productHandlers, paymentHandlers);

export const start = customerStart;

export { asks, handlers };
