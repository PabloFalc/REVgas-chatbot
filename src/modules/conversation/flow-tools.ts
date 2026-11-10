import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import { maskPhone } from 'src/utils/mask';
import { AddressService } from '../address/address.service';
import { AiUsageRepository } from '../assistant/ai-usage.repository';
import { AssistantService } from '../assistant/assistant.service';
import { CatalogRepository } from '../catalog/catalog.repository';
import { CustomerRepository } from '../customer/customer.repository';
import { HandoffService } from '../handoff/handoff.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { OrderRepository } from '../order/order.repository';
import { ConversationRepository } from './conversation.repository';
import type { FlowTools, OrderState } from './flow/flow.types';

const INTERPRET_COST = 1;
const QUESTION_COST = 2;
const ADDRESS_COST = 1;

@Injectable()
export class FlowToolsService {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly catalog: CatalogRepository,
    private readonly orders: OrderRepository,
    private readonly addresses: AddressService,
    private readonly assistant: AssistantService,
    private readonly conversations: ConversationRepository,
    private readonly handoff: HandoffService,
    private readonly knowledge: KnowledgeService,
    private readonly aiUsage: AiUsageRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FlowToolsService.name);
  }

  forPhone(phone: string, save: (state: OrderState) => Promise<void>): FlowTools {
    return {
      phone,
      findCustomer: phone => this.customers.findByPhone(phone),
      createCustomer: input => this.customers.create(input),
      customerHistory: customerId => this.customers.history(customerId),
      isVerified: (phone, customerId) => this.conversations.isVerified(phone, customerId),
      markVerified: (phone, customerId) => this.conversations.markVerified(phone, customerId),
      registerCpfMismatch: phone => this.conversations.registerCpfMismatch(phone),
      isBlocked: phone => this.conversations.isBlocked(phone),
      registerMisunderstood: () => this.conversations.registerMisunderstood(phone),
      resetMisunderstood: () => this.conversations.resetMisunderstood(phone),
      registerOffense: () => this.conversations.registerOffense(phone),
      addressFromCep: cep => this.addresses.fromCep(cep),
      addressFromText: async text => {
        if (!(await this.withinLimit(phone, ADDRESS_COST))) return null;
        return this.addresses.fromText(text);
      },
      interpret: async (text, context) => {
        if (!(await this.withinLimit(phone, INTERPRET_COST))) return null;
        return this.assistant.interpret(text, context);
      },
      answerQuestion: async text => {
        if (!(await this.withinLimit(phone, QUESTION_COST))) {
          return { kind: 'unknown', reason: 'unavailable' };
        }
        return this.knowledge.answerQuestion(text);
      },
      basePrices: () => this.catalog.basePrices(),
      listProducts: customer => this.catalog.listProducts(customer),
      listPaymentOptions: () => this.catalog.listPaymentOptions(),
      quote: (customer, productId, paymentType, quantity) =>
        this.catalog.quote(customer, productId, paymentType, quantity),
      createSale: order => this.orders.createSale(order),
      findRecentSale: (order, since) => this.orders.findRecentSale(order, since),
      checkpoint: save,
      requestHandoff: request => this.handoff.requestHandoff(request),
      serviceHours: async () => this.handoff.serviceHours(),
      storePhone: env.STORE_PHONE,
      now: () => new Date(),
    };
  }

  private async withinLimit(phone: string, cost: number): Promise<boolean> {
    if (await this.aiUsage.consume(phone, cost)) return true;
    this.logger.warn(
      { component: 'assistant', phone: maskPhone(phone) },
      'Limite de IA por telefone atingido',
    );
    return false;
  }
}
