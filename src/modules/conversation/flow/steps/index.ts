import { asks as addressAsks, handlers as addressHandlers } from './address.step';
import {
  asks as customerAsks,
  handlers as customerHandlers,
  start as customerStart,
} from './customer.step';
import { asks as paymentAsks, handlers as paymentHandlers } from './payment.step';
import { asks as productAsks, handlers as productHandlers } from './product.step';
import { asks, handlers } from './registry';
import { asks as summaryAsks, handlers as summaryHandlers } from './summary.step';

Object.assign(asks, customerAsks, addressAsks, productAsks, paymentAsks, summaryAsks);
Object.assign(
  handlers,
  customerHandlers,
  addressHandlers,
  productHandlers,
  paymentHandlers,
  summaryHandlers,
);

export const start = customerStart;

export { asks, handlers };
