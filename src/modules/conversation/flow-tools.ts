import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import { RevgasError } from 'src/core/erros/revgas/revgas.errors';
import { maskPhone } from 'src/utils/mask';
import { AddressService } from '../address/address.service';
import { AiUsageRepository } from '../assistant/ai-usage.repository';
import { AssistantService } from '../assistant/assistant.service';
import { CatalogRepository } from '../catalog/catalog.repository';
import { CustomerRepository } from '../customer/customer.repository';
import { HandoffService } from '../handoff/handoff.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { BotEventsRepository } from '../metrics/bot-events.repository';
import type { MetricEvent } from '../metrics/contracts/metrics.types';
import { SaleRejectedError } from '../order/contracts/order.types';
import { OrderRepository } from '../order/order.repository';
import { ConversationRepository } from './conversation.repository';
import type { FlowTools, OrderState } from './flow/flow.types';
import { MAX_CPF_ATTEMPTS } from './flow/flow.types';
import { STUCK_AFTER } from './flow/free-text';
import { OFFENSE_AFTER } from './flow/intent';

const INTERPRET_COST = 1;
const QUESTION_COST = 2;
const ADDRESS_COST = 1;
const NAME_COST = 1;

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
    private readonly events: BotEventsRepository,
  ) {
    this.logger.setContext(FlowToolsService.name);
  }

  forPhone(phone: string, save: (state: OrderState) => Promise<void>, cycleId?: string): FlowTools {
    const track = (event: MetricEvent) => this.track({ ...event, cycleId });
    return {
      phone,
      track,
      findCustomer: phone => this.customers.findByPhone(phone),
      createCustomer: input => this.customers.create(input),
      customerHistory: customerId => this.customers.history(customerId),
      isVerified: (phone, customerId) => this.conversations.isVerified(phone, customerId),
      markVerified: (phone, customerId) => this.conversations.markVerified(phone, customerId),
      registerCpfMismatch: async phone => {
        const amount = await this.conversations.registerCpfMismatch(phone);
        track({ name: 'cpf', outcome: 'mismatch', amount });
        if (amount >= MAX_CPF_ATTEMPTS) track({ name: 'cpf', outcome: 'blocked', amount });
        return amount;
      },
      isBlocked: async phone => {
        const blocked = await this.conversations.isBlocked(phone);
        if (blocked) track({ name: 'cpf', outcome: 'blocked_hit', amount: MAX_CPF_ATTEMPTS });
        return blocked;
      },
      registerMisunderstood: async () => {
        const count = await this.conversations.registerMisunderstood(phone);
        if (count >= STUCK_AFTER) track({ name: 'handoff_offered', reason: 'stuck' });
        return count;
      },
      resetMisunderstood: () => this.conversations.resetMisunderstood(phone),
      registerOffense: async () => {
        const count = await this.conversations.registerOffense(phone);
        if (count >= OFFENSE_AFTER) track({ name: 'handoff_offered', reason: 'offense' });
        return count;
      },
      addressFromCep: cep => this.addresses.fromCep(cep),
      addressFromText: async text => {
        if (!(await this.withinLimit(phone, ADDRESS_COST, 'address', cycleId))) return null;
        return this.addresses.fromText(text);
      },
      interpret: async (text, context) => {
        if (!(await this.withinLimit(phone, INTERPRET_COST, 'interpret', cycleId))) return null;
        return this.assistant.interpret(text, context);
      },
      readName: async text => {
        if (!(await this.withinLimit(phone, NAME_COST, 'read_name', cycleId))) return null;
        return this.assistant.readName(text);
      },
      answerQuestion: async text => {
        const startedAt = Date.now();
        const answer = (await this.withinLimit(phone, QUESTION_COST, 'question', cycleId))
          ? await this.knowledge.answerQuestion(text)
          : { kind: 'unknown' as const, reason: 'unavailable' as const };
        track({
          name: 'rag',
          outcome: answer.kind,
          reason: answer.kind === 'unknown' ? answer.reason : undefined,
          durationMs: Date.now() - startedAt,
        });
        return answer;
      },
      knowledgeTopics: () => this.knowledge.topics(),
      basePrices: () => this.catalog.basePrices(),
      listProducts: customer => this.catalog.listProducts(customer),
      listPaymentOptions: () => this.catalog.listPaymentOptions(),
      quote: (customer, productId, paymentType, quantity) =>
        this.catalog.quote(customer, productId, paymentType, quantity),
      latestOrderStatus: async (customerId, now) => {
        const status = await this.orders.latestOrderStatus(customerId, now);
        track({ name: 'order_status', outcome: status ? 'found' : 'none' });
        return status;
      },
      createSale: async order => {
        try {
          const sale = await this.orders.createSale(order);
          track({ name: 'sale', outcome: 'created', reason: 'direct' });
          return sale;
        } catch (error) {
          track({
            name: 'sale',
            outcome: error instanceof SaleRejectedError ? 'rejected' : 'failed',
            reason: error instanceof RevgasError ? error.kind : 'unexpected',
          });
          throw error;
        }
      },
      findRecentSale: async (order, since) => {
        const sale = await this.orders.findRecentSale(order, since);
        if (sale !== null) track({ name: 'sale', outcome: 'created', reason: 'recovered' });
        return sale;
      },
      checkpoint: save,
      requestHandoff: async request => {
        const outcome = await this.handoff.requestHandoff(request);
        track({ name: 'handoff', reason: request.reason, outcome: outcome.status });
        return outcome;
      },
      serviceHours: async () => this.handoff.serviceHours(),
      storePhone: env.STORE_PHONE,
      now: () => new Date(),
    };
  }

  private track(event: MetricEvent): void {
    this.events.record(event);
  }

  private async withinLimit(
    phone: string,
    cost: number,
    reason: 'interpret' | 'read_name' | 'address' | 'question',
    cycleId?: string,
  ): Promise<boolean> {
    const allowed = await this.aiUsage.consume(phone, cost);
    this.track({
      name: 'ai_call',
      cycleId,
      outcome: allowed ? 'allowed' : 'limited',
      reason,
      amount: cost,
    });
    if (allowed) return true;
    this.logger.warn(
      { component: 'assistant', phone: maskPhone(phone) },
      'Limite de IA por telefone atingido',
    );
    return false;
  }
}
