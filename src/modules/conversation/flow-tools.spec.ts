import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { AddressService } from '../address/address.service';
import type { AiUsageRepository } from '../assistant/ai-usage.repository';
import type { AssistantService } from '../assistant/assistant.service';
import type { CatalogRepository } from '../catalog/catalog.repository';
import type { CustomerRepository } from '../customer/customer.repository';
import type { HandoffService } from '../handoff/handoff.service';
import type { KnowledgeService } from '../knowledge/knowledge.service';
import type { OrderRepository } from '../order/order.repository';
import type { ConversationRepository } from './conversation.repository';
import { FlowToolsService } from './flow-tools';

const PHONE = '5586999991234';

function setup() {
  const customers = {
    findByPhone: vi.fn(async () => null),
    create: vi.fn(),
    history: vi.fn(),
  };
  const catalog = {
    listProducts: vi.fn(async () => []),
    listPaymentOptions: vi.fn(),
    quote: vi.fn(),
    basePrices: vi.fn(async () => [
      { product: { id: 1, name: 'P13' }, minPrice: 105, varies: true },
    ]),
  };
  const orders = { createSale: vi.fn(async () => 7), findRecentSale: vi.fn(async () => null) };
  const addresses = { fromCep: vi.fn(async () => null), fromText: vi.fn(async () => null) };
  const assistant = { interpret: vi.fn(async () => null) };
  const conversations = {
    isVerified: vi.fn(async () => true),
    markVerified: vi.fn(async () => undefined),
    registerCpfMismatch: vi.fn(async () => 2),
    isBlocked: vi.fn(async () => false),
    registerMisunderstood: vi.fn(async () => 2),
    resetMisunderstood: vi.fn(async () => undefined),
    registerOffense: vi.fn(async () => 3),
  };
  const knowledge = {
    answerQuestion: vi.fn(async () => ({ kind: 'answered', text: 'ok', sources: ['a'] })),
  };
  const aiUsage = { consume: vi.fn(async () => true) };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const handoff = {
    requestHandoff: vi.fn(async () => ({ status: 'queued', open: true, nextOpening: null })),
    serviceHours: vi.fn(() => ({ open: true, nextOpening: null, windows: [] })),
  };
  const service = new FlowToolsService(
    customers as unknown as CustomerRepository,
    catalog as unknown as CatalogRepository,
    orders as unknown as OrderRepository,
    addresses as unknown as AddressService,
    assistant as unknown as AssistantService,
    conversations as unknown as ConversationRepository,
    handoff as unknown as HandoffService,
    knowledge as unknown as KnowledgeService,
    aiUsage as unknown as AiUsageRepository,
    logger as unknown as PinoLogger,
  );
  return {
    service,
    customers,
    catalog,
    orders,
    addresses,
    assistant,
    conversations,
    handoff,
    knowledge,
    aiUsage,
    logger,
  };
}

describe('FlowToolsService.forPhone', () => {
  it('liga requestHandoff e serviceHours ao HandoffService', async () => {
    const { service, handoff } = setup();
    const tools = service.forPhone(PHONE, async () => undefined);
    const request = { phone: '5586999991234', reason: 'customer_request' as const, summary: null };
    await expect(tools.requestHandoff(request)).resolves.toMatchObject({ status: 'queued' });
    await expect(tools.serviceHours()).resolves.toMatchObject({ open: true });
    expect(handoff.requestHandoff).toHaveBeenCalledWith(request);
    expect(handoff.serviceHours).toHaveBeenCalledOnce();
  });

  it('delega cada ferramenta ao repositório ou serviço correspondente', async () => {
    const { service, customers, catalog, orders, addresses } = setup();
    const tools = service.forPhone(PHONE, async () => undefined);
    const customer = { id: 1, tagId: null };

    await tools.findCustomer('5586999991234');
    await tools.listProducts(customer);
    await tools.quote(customer, 3, 'PIX', 2);
    await tools.addressFromCep('64000000');
    await tools.addressFromText('rua x');
    await expect(tools.createSale({} as never)).resolves.toBe(7);
    await tools.findRecentSale({} as never, new Date());

    expect(customers.findByPhone).toHaveBeenCalledWith('5586999991234');
    expect(catalog.quote).toHaveBeenCalledWith(customer, 3, 'PIX', 2);
    expect(addresses.fromCep).toHaveBeenCalledWith('64000000');
    expect(addresses.fromText).toHaveBeenCalledWith('rua x');
    expect(orders.findRecentSale).toHaveBeenCalledOnce();
  });

  it('ferramentas de identidade delegam ao repositório da conversa', async () => {
    const { service, conversations } = setup();
    const tools = service.forPhone(PHONE, async () => undefined);
    const phone = '5586999991234';

    await expect(tools.isVerified(phone, 1)).resolves.toBe(true);
    await tools.markVerified(phone, 1);
    await expect(tools.registerCpfMismatch(phone)).resolves.toBe(2);
    await expect(tools.isBlocked(phone)).resolves.toBe(false);

    expect(conversations.isVerified).toHaveBeenCalledWith(phone, 1);
    expect(conversations.markVerified).toHaveBeenCalledWith(phone, 1);
    expect(conversations.registerCpfMismatch).toHaveBeenCalledWith(phone);
    expect(conversations.isBlocked).toHaveBeenCalledWith(phone);
  });

  it('interpret delega ao assistente com os mesmos argumentos', async () => {
    const { service, assistant } = setup();
    const tools = service.forPhone(PHONE, async () => undefined);
    const context = { products: ['Botijão P13'], payments: [{ type: 'PIX', label: 'Pix' }] };

    await tools.interpret('2 botijões', context);

    expect(assistant.interpret).toHaveBeenCalledWith('2 botijões', context);
  });

  it('checkpoint grava pelo save recebido e now devolve uma data', async () => {
    const { service } = setup();
    const save = vi.fn(async () => undefined);
    const tools = service.forPhone(PHONE, save);

    await tools.checkpoint({ step: 'askName', customer: {} });

    expect(save).toHaveBeenCalledWith({ step: 'askName', customer: {} });
    expect(tools.now()).toBeInstanceOf(Date);
  });

  it('expõe o telefone e liga contadores e preço base ao telefone da conversa', async () => {
    const { service, conversations, catalog } = setup();
    const tools = service.forPhone(PHONE, async () => undefined);

    expect(tools.phone).toBe(PHONE);
    await expect(tools.registerMisunderstood()).resolves.toBe(2);
    await tools.resetMisunderstood();
    await expect(tools.registerOffense()).resolves.toBe(3);
    await expect(tools.basePrices()).resolves.toHaveLength(1);

    expect(conversations.registerMisunderstood).toHaveBeenCalledWith(PHONE);
    expect(conversations.resetMisunderstood).toHaveBeenCalledWith(PHONE);
    expect(conversations.registerOffense).toHaveBeenCalledWith(PHONE);
    expect(catalog.basePrices).toHaveBeenCalledOnce();
  });

  it('interpret consome 1 e, dentro do limite, chama o assistente', async () => {
    const { service, aiUsage, assistant } = setup();
    const tools = service.forPhone(PHONE, async () => undefined);

    await tools.interpret('x', { products: [], payments: [] });

    expect(aiUsage.consume).toHaveBeenCalledWith(PHONE, 1);
    expect(assistant.interpret).toHaveBeenCalledOnce();
  });

  it('interpret acima do limite devolve null sem chamar o assistente e avisa sem o telefone cru', async () => {
    const { service, aiUsage, assistant, logger } = setup();
    aiUsage.consume.mockResolvedValueOnce(false);
    const tools = service.forPhone(PHONE, async () => undefined);

    await expect(tools.interpret('x', { products: [], payments: [] })).resolves.toBeNull();

    expect(assistant.interpret).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(PHONE);
  });

  it('addressFromText consome 1 e, dentro do limite, delega ao AddressService', async () => {
    const { service, aiUsage, addresses } = setup();
    const tools = service.forPhone(PHONE, async () => undefined);

    await tools.addressFromText('rua x, 10');

    expect(aiUsage.consume).toHaveBeenCalledWith(PHONE, 1);
    expect(addresses.fromText).toHaveBeenCalledWith('rua x, 10');
  });

  it('addressFromText acima do limite devolve null sem chamar o AddressService', async () => {
    const { service, aiUsage, addresses, logger } = setup();
    aiUsage.consume.mockResolvedValueOnce(false);
    const tools = service.forPhone(PHONE, async () => undefined);

    await expect(tools.addressFromText('rua x, 10')).resolves.toBeNull();

    expect(addresses.fromText).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(PHONE);
  });

  it('answerQuestion consome 2 e delega ao KnowledgeService', async () => {
    const { service, aiUsage, knowledge } = setup();
    const tools = service.forPhone(PHONE, async () => undefined);

    await expect(tools.answerQuestion('vocês entregam?')).resolves.toMatchObject({
      kind: 'answered',
    });

    expect(aiUsage.consume).toHaveBeenCalledWith(PHONE, 2);
    expect(knowledge.answerQuestion).toHaveBeenCalledWith('vocês entregam?');
  });

  it('answerQuestion acima do limite devolve unavailable sem chamar o KnowledgeService', async () => {
    const { service, aiUsage, knowledge } = setup();
    aiUsage.consume.mockResolvedValueOnce(false);
    const tools = service.forPhone(PHONE, async () => undefined);

    await expect(tools.answerQuestion('x')).resolves.toEqual({
      kind: 'unknown',
      reason: 'unavailable',
    });
    expect(knowledge.answerQuestion).not.toHaveBeenCalled();
  });
});
