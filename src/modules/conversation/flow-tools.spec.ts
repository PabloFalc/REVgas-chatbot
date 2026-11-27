import type { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import {
  mapRevgasError,
  RevgasError,
  RevgasResponseError,
  RevgasUnknownOutcomeError,
} from 'src/core/erros/revgas/revgas.errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressService } from '../address/address.service';
import type { AiUsageRepository } from '../assistant/ai-usage.repository';
import type { AssistantService } from '../assistant/assistant.service';
import type { CatalogRepository } from '../catalog/catalog.repository';
import type { CustomerRepository } from '../customer/customer.repository';
import type { HandoffService } from '../handoff/handoff.service';
import type { KnowledgeService } from '../knowledge/knowledge.service';
import type { BotEventsRepository } from '../metrics/bot-events.repository';
import {
  SaleAttemptStoreError,
  SaleRejectedError,
  SaleUncertainError,
} from '../order/contracts/order.types';
import type { OrderRepository } from '../order/order.repository';
import type { SaleAttemptsRepository } from '../order/sale-attempts.repository';
import type { ConversationRepository } from './conversation.repository';
import { customerSegmentOf } from './flow/customer-segment';
import { FlowToolsService } from './flow-tools';

const PHONE = '5586999991234';
const CYCLE = '6f1c2b8e-4a1d-4c8e-9f3a-2b7d5e0c1a90';

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
  const assistant = {
    interpret: vi.fn(async () => null),
    readName: vi.fn(async () => ({ name: 'Ana Souza', isPersonName: true })),
  };
  const conversations = {
    verifiedCustomer: vi.fn(async () => 1),
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
    topics: vi.fn(async () => ['Troco']),
  };
  const aiUsage = { consume: vi.fn(async () => true) };
  const events = { record: vi.fn() };
  const logger = { setContext: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const handoff = {
    requestHandoff: vi.fn(async () => ({ status: 'queued', open: true, nextOpening: null })),
    serviceHours: vi.fn(() => ({ open: true, nextOpening: null, windows: [] })),
  };
  const attempts = {
    begin: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    statusOf: vi.fn(async () => null),
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
    events as unknown as BotEventsRepository,
    attempts as unknown as SaleAttemptsRepository,
  );
  return {
    service,
    attempts,
    events,
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
    const tools = service.forPhone(PHONE, async () => undefined, CYCLE);
    const customer = { id: 1, tagId: null };

    await tools.findCustomer('5586999991234');
    await tools.listProducts(customer);
    await tools.quote(customer, 3, 'PIX', 2);
    await tools.addressFromCep('64000000');
    await tools.addressFromText('rua x');
    await expect(tools.createSale({} as never, { segment: 'recurring' })).resolves.toBe(7);
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

    await expect(tools.verifiedCustomer(phone)).resolves.toBe(1);
    await expect(tools.isVerified(phone, 1)).resolves.toBe(true);
    await tools.markVerified(phone, 1);
    await expect(tools.registerCpfMismatch(phone)).resolves.toBe(2);
    await expect(tools.isBlocked(phone)).resolves.toBe(false);

    expect(conversations.verifiedCustomer).toHaveBeenCalledWith(phone);
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

  it('knowledgeTopics lê os assuntos da base sem gastar o limite de IA', async () => {
    const { service, aiUsage, knowledge } = setup();
    const tools = service.forPhone(PHONE, async () => undefined);

    await expect(tools.knowledgeTopics()).resolves.toEqual(['Troco']);
    expect(knowledge.topics).toHaveBeenCalledOnce();
    expect(aiUsage.consume).not.toHaveBeenCalled();
  });

  it('readName consome 1 e, dentro do limite, chama o assistente', async () => {
    const { service, aiUsage, assistant } = setup();
    const tools = service.forPhone(PHONE, async () => undefined);

    await expect(tools.readName('sou a Ana Souza')).resolves.toEqual({
      name: 'Ana Souza',
      isPersonName: true,
    });

    expect(aiUsage.consume).toHaveBeenCalledWith(PHONE, 1);
    expect(assistant.readName).toHaveBeenCalledWith('sou a Ana Souza');
  });

  it('readName acima do limite devolve null sem chamar o assistente', async () => {
    const { service, aiUsage, assistant } = setup();
    aiUsage.consume.mockResolvedValueOnce(false);
    const tools = service.forPhone(PHONE, async () => undefined);

    await expect(tools.readName('Ana Souza')).resolves.toBeNull();
    expect(assistant.readName).not.toHaveBeenCalled();
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

const saleOrder = {
  customerId: 1,
  address: { street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'Teresina', state: 'PI' },
  productId: 1,
  productName: 'P13',
  quantity: 1,
  unitPrice: 100,
  paymentType: 'PIX',
  total: 100,
};

describe('FlowToolsService métricas', () => {
  it('grava criação e recuperação sem incluir dados do pedido', async () => {
    const { service, events, orders } = setup();
    const tools = service.forPhone(PHONE, async () => undefined, 'cycle');
    await expect(tools.createSale(saleOrder, { segment: 'recurring' })).resolves.toBe(7);
    expect(events.record).toHaveBeenLastCalledWith({
      name: 'sale',
      cycleId: 'cycle',
      outcome: 'created',
      reason: 'direct',
    });
    orders.findRecentSale.mockResolvedValueOnce(8 as never);
    await expect(tools.findRecentSale(saleOrder, new Date())).resolves.toBe(8);
    expect(events.record).toHaveBeenLastCalledWith({
      name: 'sale',
      cycleId: 'cycle',
      outcome: 'created',
      reason: 'recovered',
    });
  });

  it.each([
    [new Error('segredo'), 'failed', 'unexpected'],
    [new SaleRejectedError('segredo'), 'rejected', 'unexpected'],
    [new RevgasError('unavailable', 'segredo'), 'failed', 'unavailable'],
  ])('preserva o erro de venda e registra apenas classificação', async (error, outcome, reason) => {
    const { service, events, orders } = setup();
    orders.createSale.mockRejectedValueOnce(error);
    await expect(
      service
        .forPhone(PHONE, async () => undefined, CYCLE)
        .createSale(saleOrder, {
          segment: 'recurring',
        }),
    ).rejects.toBe(error);
    expect(events.record).toHaveBeenCalledWith({
      name: 'sale',
      cycleId: CYCLE,
      outcome,
      reason,
    });
  });

  it('registra CPF, ofertas, handoff, RAG e uso de IA', async () => {
    const { service, events, conversations, aiUsage, knowledge } = setup();
    const tools = service.forPhone(PHONE, async () => undefined);
    conversations.registerCpfMismatch.mockResolvedValueOnce(3);
    conversations.isBlocked.mockResolvedValueOnce(true);
    conversations.registerMisunderstood.mockResolvedValueOnce(3);
    await expect(tools.registerCpfMismatch(PHONE)).resolves.toBe(3);
    await expect(tools.isBlocked(PHONE)).resolves.toBe(true);
    await tools.registerMisunderstood();
    await tools.registerOffense();
    await tools.requestHandoff({ phone: PHONE, reason: 'customer_request', summary: null });
    await tools.answerQuestion('pergunta');
    aiUsage.consume.mockResolvedValueOnce(false);
    await tools.answerQuestion('pergunta');
    knowledge.answerQuestion.mockResolvedValueOnce({
      kind: 'unknown',
      reason: 'no_match',
    } as never);
    await tools.answerQuestion('pergunta');
    for (const event of [
      { name: 'cpf', outcome: 'mismatch', amount: 3 },
      { name: 'cpf', outcome: 'blocked', amount: 3 },
      { name: 'cpf', outcome: 'blocked_hit', amount: 3 },
      { name: 'handoff_offered', reason: 'stuck' },
      { name: 'handoff_offered', reason: 'offense' },
      { name: 'handoff', reason: 'customer_request', outcome: 'queued' },
      { name: 'rag', outcome: 'answered', durationMs: expect.any(Number) },
      { name: 'rag', outcome: 'unknown', reason: 'unavailable', durationMs: expect.any(Number) },
      { name: 'rag', outcome: 'unknown', reason: 'no_match', durationMs: expect.any(Number) },
      { name: 'ai_call', outcome: 'allowed', reason: 'question', amount: 2 },
      { name: 'ai_call', outcome: 'limited', reason: 'question', amount: 2 },
    ])
      expect(events.record).toHaveBeenCalledWith(expect.objectContaining(event));
  });

  it('order_cancelled herda o ciclo como os demais eventos do fluxo', () => {
    const { service, events } = setup();
    service.forPhone(PHONE, async () => undefined, 'cycle').track({ name: 'order_cancelled' });
    expect(events.record).toHaveBeenCalledWith({ name: 'order_cancelled', cycleId: 'cycle' });
  });
});

it('registra resultado de consulta de pedido e mantém o valor', async () => {
  const { service, events, orders } = setup();
  const status = { saleId: 7, status: 'DELIVERED' };
  Object.assign(orders, {
    latestOrderStatus: vi.fn().mockResolvedValueOnce(status).mockResolvedValueOnce(null),
  });
  const tools = service.forPhone(PHONE, async () => undefined);
  await expect(tools.latestOrderStatus(1, new Date())).resolves.toBe(status);
  await expect(tools.latestOrderStatus(1, new Date())).resolves.toBeNull();
  expect(events.record).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'order_status', outcome: 'found' }),
  );
  expect(events.record).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'order_status', outcome: 'none' }),
  );
});

it('identifica o custo de cada chamada de IA', async () => {
  const { service, events } = setup();
  const tools = service.forPhone(PHONE, async () => undefined);
  await tools.interpret('oi', { products: [], payments: [] });
  await tools.readName('Ana');
  await tools.addressFromText('rua');
  await tools.answerQuestion('pergunta');
  for (const [reason, amount] of [
    ['interpret', 1],
    ['read_name', 1],
    ['address', 1],
    ['question', 2],
  ]) {
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ai_call', outcome: 'allowed', reason, amount }),
    );
  }
});

const revgasEnv = {
  REVGAS_MODE: env.REVGAS_MODE,
  REVGAS_API_KEY: env.REVGAS_API_KEY,
  REVGAS_ESTABLISHMENT_ID: env.REVGAS_ESTABLISHMENT_ID,
};

describe('FlowToolsService tentativa de venda', () => {
  afterEach(() => {
    Object.assign(env, revgasEnv);
  });

  const createSale = (error?: unknown) => {
    const ctx = setup();
    if (error !== undefined) ctx.orders.createSale.mockRejectedValueOnce(error);
    const tools = ctx.service.forPhone(PHONE, async () => undefined, CYCLE);
    return { ...ctx, tools, run: () => tools.createSale(saleOrder, { segment: 'recurring' }) };
  };

  const unknownEvent = (reason: string) => ({
    name: 'sale_outcome_unknown',
    cycleId: CYCLE,
    reason,
    isSimulated: true,
  });

  it('grava a tentativa pendente antes de criar a venda', async () => {
    const { attempts, orders, run } = createSale();

    await expect(run()).resolves.toBe(7);

    expect(attempts.begin).toHaveBeenCalledExactlyOnceWith({
      cycleId: CYCLE,
      customerId: 1,
      totalCents: 10000,
      productCode: '1',
      paymentMethodCode: 'PIX',
      customerSegment: 'recurring',
      isSimulated: true,
    });
    expect(attempts.finish).toHaveBeenCalledExactlyOnceWith(CYCLE, {
      status: 'registered',
      erpSaleId: 7,
    });
    const [begin] = attempts.begin.mock.invocationCallOrder;
    const [post] = orders.createSale.mock.invocationCallOrder;
    const [finish] = attempts.finish.mock.invocationCallOrder;
    expect(begin).toBeLessThan(post);
    expect(post).toBeLessThan(finish);
  });

  it('não cria a venda quando a tentativa não pode ser gravada', async () => {
    const { attempts, orders, logger, events, run } = createSale();
    const error = new SaleAttemptStoreError('Falha ao gravar a tentativa de venda', {
      cause: new Error('senha do banco 12345678909'),
    });
    attempts.begin.mockRejectedValueOnce(error);

    await expect(run()).rejects.toBe(error);

    expect(orders.createSale).not.toHaveBeenCalled();
    expect(attempts.finish).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0][0]).toMatchObject({ cycleId: CYCLE });
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain('12345678909');
    expect(logged).not.toContain(PHONE);
    expect(events.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'sale_outcome_unknown' }),
    );
  });

  it('não cria a venda quando a tentativa não tem ciclo', async () => {
    const { service, attempts, orders } = setup();
    const tools = service.forPhone(PHONE, async () => undefined);

    await expect(tools.createSale(saleOrder, { segment: 'recurring' })).rejects.toBeInstanceOf(
      SaleAttemptStoreError,
    );

    expect(attempts.begin).not.toHaveBeenCalled();
    expect(orders.createSale).not.toHaveBeenCalled();
  });

  it('timeout marca a tentativa como incerta com error_kind timeout', async () => {
    const error = new RevgasUnknownOutcomeError('timeout', 'timeout');
    const { attempts, orders, events, run } = createSale(error);

    await expect(run()).rejects.toBe(error);

    expect(orders.createSale).toHaveBeenCalledOnce();
    expect(attempts.finish).toHaveBeenCalledExactlyOnceWith(CYCLE, {
      status: 'uncertain',
      errorKind: 'timeout',
    });
    expect(events.record).toHaveBeenCalledWith(unknownEvent('timeout'));
  });

  it('resposta ilegível marca a tentativa como incerta', async () => {
    const error = new RevgasResponseError('schema', [{ path: 'id', message: 'required' }], 200);
    const { attempts, events, run } = createSale(error);

    await expect(run()).rejects.toBe(error);

    expect(attempts.finish).toHaveBeenCalledExactlyOnceWith(CYCLE, {
      status: 'uncertain',
      errorKind: 'invalid_response',
    });
    expect(events.record).toHaveBeenCalledWith(unknownEvent('invalid_response'));
  });

  it('429 no POST marca a tentativa como incerta com error_kind unavailable', async () => {
    const error = mapRevgasError(429, { message: 'too many requests' });
    const { attempts, orders, events, run } = createSale(error);

    await expect(run()).rejects.toBe(error);

    expect(orders.createSale).toHaveBeenCalledOnce();
    expect(attempts.finish).toHaveBeenCalledExactlyOnceWith(CYCLE, {
      status: 'uncertain',
      errorKind: 'unavailable',
    });
    expect(events.record).toHaveBeenCalledWith(unknownEvent('other'));
  });

  it('erro de lock no POST marca a tentativa como incerta com error_kind unavailable', async () => {
    const error = mapRevgasError(409, { message: 'Resource lock, try again' });
    const { attempts, orders, events, run } = createSale(error);

    await expect(run()).rejects.toBe(error);

    expect(orders.createSale).toHaveBeenCalledOnce();
    expect(attempts.finish).toHaveBeenCalledExactlyOnceWith(CYCLE, {
      status: 'uncertain',
      errorKind: 'unavailable',
    });
    expect(events.record).toHaveBeenCalledWith(unknownEvent('other'));
  });

  it('recusa definitiva ou validação não marcam a tentativa como incerta', async () => {
    const cases = [
      [mapRevgasError(401, {}), { status: 'failed', errorKind: 'unauthorized' }],
      [mapRevgasError(402, {}), { status: 'failed', errorKind: 'blocked' }],
      [mapRevgasError(403, {}), { status: 'failed', errorKind: 'forbidden' }],
      [mapRevgasError(404, {}), { status: 'failed', errorKind: 'not_found' }],
      [new SaleRejectedError('inválida'), { status: 'rejected', errorKind: 'validation' }],
    ] as const;
    for (const [error, outcome] of cases) {
      const { attempts, events, run } = createSale(error);

      await expect(run()).rejects.toBe(error);

      expect(attempts.finish).toHaveBeenCalledExactlyOnceWith(CYCLE, outcome);
      expect(events.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: 'sale_outcome_unknown' }),
      );
    }
  });

  it('devolve o número da venda quando o resultado não pode ser gravado', async () => {
    const { attempts, orders, logger, run } = createSale();
    attempts.finish.mockRejectedValueOnce(new Error('conexão perdida 12345678909'));

    await expect(run()).resolves.toBe(7);

    expect(orders.createSale).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0][0]).toMatchObject({ cycleId: CYCLE, saleId: 7 });
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain('12345678909');
    expect(logged).not.toContain(PHONE);
  });

  it('modo híbrido grava a tentativa como simulada', async () => {
    for (const [mode, isSimulated] of [
      ['hybrid', true],
      ['live', false],
    ] as const) {
      Object.assign(env, {
        REVGAS_MODE: mode,
        REVGAS_API_KEY: 'chave-de-teste',
        REVGAS_ESTABLISHMENT_ID: 1,
      });
      const { attempts, tools, run } = createSale();

      await run();

      expect(attempts.begin).toHaveBeenCalledWith(expect.objectContaining({ isSimulated }));
      expect(tools.demo).toBe(isSimulated);
    }
  });

  it('cliente sem histórico carregado conta como novo', async () => {
    const { attempts, tools } = createSale();
    const segment = customerSegmentOf({ step: 'summary', customer: {} });

    await tools.createSale(saleOrder, { segment });

    expect(attempts.begin).toHaveBeenCalledWith(
      expect.objectContaining({ customerSegment: 'new' }),
    );
  });

  it('não cria a venda quando o mesmo cliente tem tentativa incerta recente em outro ciclo', async () => {
    const error = new SaleUncertainError('Tentativa incerta recente do mesmo cliente');
    const { attempts, orders, events, run } = createSale();
    attempts.begin.mockRejectedValueOnce(error);

    await expect(run()).rejects.toBe(error);

    expect(orders.createSale).not.toHaveBeenCalled();
    expect(attempts.finish).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it('saleAttemptStatus lê a tentativa do ciclo da conversa', async () => {
    const { service, attempts } = setup();
    attempts.statusOf.mockResolvedValueOnce('uncertain' as never);

    await expect(
      service.forPhone(PHONE, async () => undefined, CYCLE).saleAttemptStatus(),
    ).resolves.toBe('uncertain');
    await expect(
      service.forPhone(PHONE, async () => undefined).saleAttemptStatus(),
    ).resolves.toBeNull();

    expect(attempts.statusOf).toHaveBeenCalledExactlyOnceWith(CYCLE);
  });
});
