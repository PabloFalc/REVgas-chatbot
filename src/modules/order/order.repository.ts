import { Inject, Injectable } from '@nestjs/common';
import { REVGAS_CLIENT, type RevgasClient } from 'src/integrations/revgas/revgas.client';
import type { SaleOrder } from './contracts/order.types';

const CHANNEL = 'WHATSAPP';
const TOLERANCE_MS = 60_000;
const SAO_PAULO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

@Injectable()
export class OrderRepository {
  constructor(@Inject(REVGAS_CLIENT) private readonly revgas: RevgasClient) {}

  async createSale(order: SaleOrder): Promise<number> {
    const { address } = order;
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
  }

  async findRecentSale(order: SaleOrder, since: Date): Promise<number | null> {
    const page = await this.revgas.sales.list({
      customer_id: order.customerId,
      channel: CHANNEL,
      from: SAO_PAULO_DATE.format(since),
    });
    const threshold = since.getTime() - TOLERANCE_MS;
    const match = page.data.find(sale => {
      if (sale.total == null || Math.abs(sale.total - order.total) >= 0.005) return false;
      const created = sale.date ? Date.parse(sale.date) : Number.NaN;
      return Number.isNaN(created) || created >= threshold;
    });
    return match?.id ?? null;
  }
}
