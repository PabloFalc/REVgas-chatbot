import { RevgasUnavailableError } from 'src/core/erros/revgas/revgas.errors';
import type { RevgasClient } from 'src/integrations/revgas/revgas.client';
import type { RevgasSale } from 'src/integrations/revgas/sales/sales.schemas';
import { describe, expect, it, vi } from 'vitest';
import type { SaleOrder } from './contracts/order.types';
import { OrderRepository } from './order.repository';

const order: SaleOrder = {
  customerId: 7,
  address: {
    street: 'Rua A',
    number: '10',
    neighborhood: 'Centro',
    city: 'Teresina',
    state: 'PI',
    complement: 'Apto 2',
    landmark: 'Perto da praça',
  },
  productId: 3,
  productName: 'Gás P13',
  quantity: 2,
  unitPrice: 100,
  paymentType: 'PIX',
  total: 200,
};

const sale = (
  id: number,
  total: number | null,
  date?: string | null,
  products: { product_id: number; quantity: number }[] = [{ product_id: 3, quantity: 2 }],
  created_at?: string | null,
) => ({ id, status: 'OPEN', total, date, created_at, products }) as RevgasSale;

const build = (sales: RevgasSale[] = []) => {
  const create = vi.fn(async () => ({ id: 99 }) as RevgasSale);
  const list = vi.fn(async () => ({
    data: sales,
    pagination: { page: 1, count: sales.length, total_count: sales.length, has_next: false },
  }));
  const client = { sales: { create, list } } as unknown as RevgasClient;
  return { repository: new OrderRepository(client), create, list };
};

describe('OrderRepository', () => {
  describe('createSale', () => {
    it('sends address, customer, product, payment and channel and returns the id', async () => {
      const { repository, create } = build();
      const id = await repository.createSale({ ...order, observation: 'Portão azul' });
      expect(id).toBe(99);
      expect(create).toHaveBeenCalledWith({
        location: 'Rua A',
        number: '10',
        neighborhood: 'Centro',
        city: 'Teresina',
        state_federation: 'PI',
        complement: 'Apto 2',
        landmark: 'Perto da praça',
        customer_id: 7,
        observation: 'Portão azul',
        channel: 'WHATSAPP',
        products: [{ product_id: 3, quantity: 2, value: 100, product_description: 'Gás P13' }],
        payments: [{ payment_type: 'PIX', value: 200 }],
      });
    });

    it('omits the observation when absent', async () => {
      const { repository, create } = build();
      await repository.createSale(order);
      const input = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(input).not.toHaveProperty('observation');
    });

    it('does not retry on failure and rethrows', async () => {
      const { repository, create } = build();
      create.mockRejectedValue(new RevgasUnavailableError('down', 503));
      await expect(repository.createSale(order)).rejects.toBeInstanceOf(RevgasUnavailableError);
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  describe('findRecentSale', () => {
    const since = new Date('2026-10-21T15:00:00.000Z');

    it('lists by customer, channel and the Sao Paulo date of since', async () => {
      const { repository, list } = build();
      await repository.findRecentSale(order, new Date('2026-10-22T01:30:00.000Z'));
      expect(list).toHaveBeenCalledWith({
        customer_id: 7,
        channel: 'WHATSAPP',
        from: '2026-10-21',
      });
    });

    it('returns the id of a sale with the same total created after since', async () => {
      const { repository } = build([
        sale(1, 150, '2026-10-21T15:01:00.000Z'),
        sale(2, 200, '2026-10-21T15:02:00.000Z'),
      ]);
      expect(await repository.findRecentSale(order, since)).toBe(2);
    });

    it('accepts a sale up to 60 seconds before since', async () => {
      const { repository } = build([sale(5, 200, '2026-10-21T14:59:30.000Z')]);
      expect(await repository.findRecentSale(order, since)).toBe(5);
    });

    it('ignores a sale older than since minus 60 seconds', async () => {
      const { repository } = build([sale(5, 200, '2026-10-21T14:58:00.000Z')]);
      expect(await repository.findRecentSale(order, since)).toBeNull();
    });

    it('compares only the total when date is missing or invalid', async () => {
      const { repository } = build([sale(6, 200, null), sale(7, 200, 'lixo')]);
      expect(await repository.findRecentSale(order, since)).toBe(6);
      const other = build([sale(7, 200, 'lixo')]);
      expect(await other.repository.findRecentSale(order, since)).toBe(7);
    });

    it('reads a zoneless datetime as Sao Paulo time', async () => {
      const { repository } = build([sale(8, 200, '2026-10-21 12:00:05')]);
      expect(await repository.findRecentSale(order, since)).toBe(8);
    });

    it('rejects a zoneless datetime 10 minutes before since', async () => {
      const { repository } = build([sale(8, 200, '2026-10-21T11:50:00')]);
      expect(await repository.findRecentSale(order, since)).toBeNull();
    });

    it('compares only the total for a date-only value', async () => {
      const { repository } = build([sale(9, 200, '2026-10-21')]);
      expect(await repository.findRecentSale(order, since)).toBe(9);
    });

    it('still honors an ISO datetime with an explicit offset', async () => {
      const { repository } = build([sale(10, 200, '2026-10-21T12:00:05-03:00')]);
      expect(await repository.findRecentSale(order, since)).toBe(10);
      const old = build([sale(10, 200, '2026-10-21T11:50:00-03:00')]);
      expect(await old.repository.findRecentSale(order, since)).toBeNull();
    });

    it('ignores a sale with the same total but a different product', async () => {
      const { repository } = build([
        sale(11, 200, '2026-10-21T15:01:00.000Z', [{ product_id: 4, quantity: 2 }]),
      ]);
      expect(await repository.findRecentSale(order, since)).toBeNull();
    });

    it('ignores a sale with the same total and product but a different quantity', async () => {
      const { repository } = build([
        sale(12, 200, '2026-10-21T15:01:00.000Z', [{ product_id: 3, quantity: 1 }]),
      ]);
      expect(await repository.findRecentSale(order, since)).toBeNull();
    });

    it('ignores a sale without products', async () => {
      const { repository } = build([sale(13, 200, null, [])]);
      expect(await repository.findRecentSale(order, since)).toBeNull();
    });

    it('matches same total, product and quantity when the date is missing', async () => {
      const { repository } = build([
        sale(14, 200, undefined, [
          { product_id: 9, quantity: 1 },
          { product_id: 3, quantity: 2 },
        ]),
      ]);
      expect(await repository.findRecentSale(order, since)).toBe(14);
    });

    it('uses created_at over date when both are present', async () => {
      const inside = build([
        sale(20, 200, '2026-10-20T10:00:00-03:00', undefined, '2026-10-21T12:01:00-03:00'),
      ]);
      expect(await inside.repository.findRecentSale(order, since)).toBe(20);
      const outside = build([
        sale(21, 200, '2026-10-21T12:01:00-03:00', undefined, '2026-10-20T10:00:00-03:00'),
      ]);
      expect(await outside.repository.findRecentSale(order, since)).toBeNull();
    });

    it('falls back to date when created_at is absent', async () => {
      const { repository } = build([sale(22, 200, '2026-10-21T12:01:00-03:00', undefined, null)]);
      expect(await repository.findRecentSale(order, since)).toBe(22);
      const old = build([sale(23, 200, '2026-10-20T10:00:00-03:00')]);
      expect(await old.repository.findRecentSale(order, since)).toBeNull();
    });

    it('returns null when nothing matches', async () => {
      const { repository } = build([sale(1, 150, '2026-10-21T15:01:00.000Z')]);
      expect(await repository.findRecentSale(order, since)).toBeNull();
    });
  });
});
