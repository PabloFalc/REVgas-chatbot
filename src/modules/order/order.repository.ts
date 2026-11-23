import { Inject, Injectable } from '@nestjs/common';
import { RevgasValidationError } from 'src/core/erros/revgas/revgas.errors';
import { REVGAS_CLIENT, type RevgasClient } from 'src/integrations/revgas/revgas.client';
import { PAGE_SIZE } from 'src/integrations/revgas/shared/pagination';
import { type OrderStatus, type SaleOrder, SaleRejectedError } from './contracts/order.types';

const CHANNEL = 'WHATSAPP';
const MAX_RECENT_SALE_PAGES = 5;
const TOLERANCE_MS = 60_000;
const SAO_PAULO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const WITH_OFFSET = /(Z|[+-]\d{2}(:?\d{2})?)$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

const saleTimestamp = (date: string | null | undefined): number => {
  if (!date || !DATE_TIME.test(date)) return Number.NaN;
  const iso = date.replace(' ', 'T');
  return Date.parse(WITH_OFFSET.test(iso) ? iso : `${iso}-03:00`);
};

@Injectable()
export class OrderRepository {
  constructor(@Inject(REVGAS_CLIENT) private readonly revgas: RevgasClient) {}

  async createSale(order: SaleOrder): Promise<number> {
    const { address } = order;
    try {
      const sale = await this.revgas.sales.create({
        location: address.street,
        number: address.number,
        neighborhood: address.neighborhood,
        city: address.city,
        state_federation: address.state,
        ...(address.complement ? { complement: address.complement } : {}),
        ...(address.landmark ? { landmark: address.landmark } : {}),
        customer_id: order.customerId,
        ...(order.observation ? { observation: order.observation } : {}),
        channel: CHANNEL,
        products: [
          {
            product_id: order.productId,
            quantity: order.quantity,
            value: order.unitPrice,
            product_description: order.productName,
          },
        ],
        payments: [{ payment_type: order.paymentType, value: order.total }],
      });
      return sale.id;
    } catch (error) {
      if (error instanceof RevgasValidationError) throw new SaleRejectedError(error.message);
      throw error;
    }
  }

  async latestOrderStatus(customerId: number, now: Date): Promise<OrderStatus | null> {
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const result = await this.revgas.sales.list({
      customer_id: customerId,
      channel: CHANNEL,
      from: SAO_PAULO_DATE.format(since),
      to: SAO_PAULO_DATE.format(now),
      page_size: 10,
    });
    const sale = result.data
      .filter(sale => {
        const created = saleTimestamp(sale.created_at ?? sale.date);
        return (
          sale.customer_id === customerId &&
          sale.channel === CHANNEL &&
          sale.status !== 'CANCEL' &&
          created >= since.getTime() &&
          created <= now.getTime()
        );
      })
      .sort(
        (a, b) => saleTimestamp(b.created_at ?? b.date) - saleTimestamp(a.created_at ?? a.date),
      )[0];
    return sale
      ? {
          saleId: sale.id,
          status: sale.status,
          delivererName: sale.deliverer_name,
          deliveredAt: sale.delivered_at,
        }
      : null;
  }

  async findRecentSale(order: SaleOrder, since: Date): Promise<number | null> {
    const threshold = since.getTime() - TOLERANCE_MS;
    const from = SAO_PAULO_DATE.format(since);
    const to = SAO_PAULO_DATE.format(new Date());
    for (let page = 1; page <= MAX_RECENT_SALE_PAGES; page++) {
      const result = await this.revgas.sales.list({
        customer_id: order.customerId,
        channel: CHANNEL,
        from,
        to,
        page,
        page_size: PAGE_SIZE,
      });
      const match = result.data.find(sale => {
        if (sale.total == null || Math.abs(sale.total - order.total) >= 0.005) return false;
        const sameItem = (sale.products ?? []).some(
          item => item.product_id === order.productId && item.quantity === order.quantity,
        );
        if (!sameItem) return false;
        const created = saleTimestamp(sale.created_at ?? sale.date);
        return !Number.isNaN(created) && created >= threshold;
      });
      if (match) return match.id;
      const { has_next, total_count } = result.pagination;
      const hasNext = has_next ?? page * PAGE_SIZE < total_count;
      if (!hasNext || result.data.length === 0) break;
    }
    return null;
  }
}
