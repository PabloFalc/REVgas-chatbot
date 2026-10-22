import { describe, expect, it, vi } from 'vitest';
import type { AddressService } from '../address/address.service';
import type { AssistantService } from '../assistant/assistant.service';
import type { CatalogRepository } from '../catalog/catalog.repository';
import type { CustomerRepository } from '../customer/customer.repository';
import type { OrderRepository } from '../order/order.repository';
import { FlowToolsService } from './flow-tools';

function setup() {
  const customers = {
    findByPhone: vi.fn(async () => null),
    create: vi.fn(),
    saveCpf: vi.fn(async () => undefined),
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
  const service = new FlowToolsService(
    customers as unknown as CustomerRepository,
    catalog as unknown as CatalogRepository,
    orders as unknown as OrderRepository,
    addresses as unknown as AddressService,
    assistant as unknown as AssistantService,
  );
  return { service, customers, catalog, orders, addresses, assistant };
}

describe('FlowToolsService.forPhone', () => {
  it('delega cada ferramenta ao repositório ou serviço correspondente', async () => {
    const { service, customers, catalog, orders, addresses } = setup();
    const tools = service.forPhone(async () => undefined);
    const customer = { id: 1, tagId: null };

    await tools.findCustomer('5586999991234');
    await tools.saveCpf(1, '12345678909');
    await tools.listProducts(customer);
    await tools.quote(customer, 3, 'PIX', 2);
    await tools.addressFromCep('64000000');
    await tools.addressFromText('rua x');
    await expect(tools.createSale({} as never)).resolves.toBe(7);
    await tools.findRecentSale({} as never, new Date());

    expect(customers.findByPhone).toHaveBeenCalledWith('5586999991234');
    expect(customers.saveCpf).toHaveBeenCalledWith(1, '12345678909');
    expect(catalog.quote).toHaveBeenCalledWith(customer, 3, 'PIX', 2);
    expect(addresses.fromCep).toHaveBeenCalledWith('64000000');
    expect(addresses.fromText).toHaveBeenCalledWith('rua x');
    expect(orders.findRecentSale).toHaveBeenCalledOnce();
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
