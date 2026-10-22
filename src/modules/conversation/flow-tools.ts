import { Injectable } from '@nestjs/common';
import { env } from 'src/config/env';
import { AddressService } from '../address/address.service';
import { CatalogRepository } from '../catalog/catalog.repository';
import { CustomerRepository } from '../customer/customer.repository';
import { OrderRepository } from '../order/order.repository';
import type { FlowTools, OrderState } from './flow/flow.types';

@Injectable()
export class FlowToolsService {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly catalog: CatalogRepository,
    private readonly orders: OrderRepository,
    private readonly addresses: AddressService,
  ) {}

  forPhone(save: (state: OrderState) => Promise<void>): FlowTools {
    return {
      findCustomer: phone => this.customers.findByPhone(phone),
      createCustomer: input => this.customers.create(input),
      saveCpf: (customerId, cpf) => this.customers.saveCpf(customerId, cpf),
      customerHistory: customerId => this.customers.history(customerId),
      addressFromCep: cep => this.addresses.fromCep(cep),
      addressFromText: text => this.addresses.fromText(text),
      listProducts: customer => this.catalog.listProducts(customer),
      listPaymentOptions: () => this.catalog.listPaymentOptions(),
      quote: (customer, productId, paymentType, quantity) =>
        this.catalog.quote(customer, productId, paymentType, quantity),
      createSale: order => this.orders.createSale(order),
      findRecentSale: (order, since) => this.orders.findRecentSale(order, since),
      checkpoint: save,
      storePhone: env.STORE_PHONE,
      now: () => new Date(),
    };
  }
}
