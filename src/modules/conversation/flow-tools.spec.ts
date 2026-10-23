import { describe, expect, it, vi } from 'vitest';
import type { AddressService } from '../address/address.service';
import type { AssistantService } from '../assistant/assistant.service';
import type { CatalogRepository } from '../catalog/catalog.repository';
import type { CustomerRepository } from '../customer/customer.repository';
import type { OrderRepository } from '../order/order.repository';
import type { ConversationRepository } from './conversation.repository';
import { FlowToolsService } from './flow-tools';

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
  };
  const orders = { createSale: vi.fn(async () => 7), findRecentSale: vi.fn(async () => null) };
  const addresses = { fromCep: vi.fn(async () => null), fromText: vi.fn(async () => null) };
  const assistant = { interpret: vi.fn(async () => null) };
  const conversations = {
    isVerified: vi.fn(async () => true),
    markVerified: vi.fn(async () => undefined),
    registerCpfMismatch: vi.fn(async () => 2),
    isBlocked: vi.fn(async () => false),
  };
  const service = new FlowToolsService(
    customers as unknown as CustomerRepository,
    catalog as unknown as CatalogRepository,
    orders as unknown as OrderRepository,
    addresses as unknown as AddressService,
    assistant as unknown as AssistantService,
    conversations as unknown as ConversationRepository,
  );
  return { service, customers, catalog, orders, addresses, assistant, conversations };
}

describe('FlowToolsService.forPhone', () => {
  it('delega cada ferramenta ao repositório ou serviço correspondente', async () => {
    const { service, customers, catalog, orders, addresses } = setup();
    const tools = service.forPhone(async () => undefined);
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
    const tools = service.forPhone(async () => undefined);
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
    const tools = service.forPhone(async () => undefined);
    const context = { products: ['Botijão P13'], payments: [{ type: 'PIX', label: 'Pix' }] };

    await tools.interpret('2 botijões', context);

    expect(assistant.interpret).toHaveBeenCalledWith('2 botijões', context);
  });

  it('checkpoint grava pelo save recebido e now devolve uma data', async () => {
    const { service } = setup();
    const save = vi.fn(async () => undefined);
    const tools = service.forPhone(save);

    await tools.checkpoint({ step: 'askName', customer: {} });

    expect(save).toHaveBeenCalledWith({ step: 'askName', customer: {} });
    expect(tools.now()).toBeInstanceOf(Date);
  });
});
