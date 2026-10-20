import { RevgasNotFoundError } from '../../../core/erros/revgas/revgas.errors';
import type { CustomersFake } from '../customers/customers.fake';
import { FAKE_ESTABLISHMENT } from '../establishments/establishments.fixtures';
import { clone, FAKE_ID_START } from '../shared/fake';
import { type Page, paginate } from '../shared/pagination';
import type { ListSalesQuery, SalesApi } from './sales.api';
import { parseSaleInput, type RevgasSale, type RevgasSaleInput } from './sales.schemas';

const ACTIVE_AFTER_MS = 2 * 60_000;
const CONFIRM_AFTER_MS = 10 * 60_000;

type StoredSale = { sale: RevgasSale; createdAt: number; cancelled: boolean };

export class SalesFake implements SalesApi {
  private readonly sales = new Map<number, StoredSale>();
  private nextId = FAKE_ID_START + 1000;

  constructor(
    private readonly customers: CustomersFake,
    private readonly now: () => number = Date.now,
  ) {}

  owns(id: number): boolean {
    return id >= FAKE_ID_START && this.sales.has(id);
  }

  async create(input: RevgasSaleInput): Promise<RevgasSale> {
    const parsed = parseSaleInput(input);
    const createdAt = this.now();
    const customer = parsed.customer_id ? this.customers.peek(parsed.customer_id) : undefined;
    const sale: RevgasSale = {
      id: this.nextId++,
      status: 'OPEN',
      channel: parsed.channel,
      total: parsed.products.reduce((sum, item) => sum + item.quantity * item.value, 0),
      customer_id: parsed.customer_id,
      customer_name: customer?.name ?? undefined,
      date: new Date(createdAt).toISOString(),
      created_at: new Date(createdAt).toISOString(),
      location: parsed.location,
      number: parsed.number,
      neighborhood: parsed.neighborhood,
      city: parsed.city,
      state_federation: parsed.state_federation,
      complement: parsed.complement,
      landmark: parsed.landmark,
      observation: parsed.observation,
      products: clone(parsed.products),
      payments: clone(parsed.payments),
      establishment_id: FAKE_ESTABLISHMENT.id,
    };
    this.sales.set(sale.id, { sale, createdAt, cancelled: false });
    return this.view(this.sales.get(sale.id) as StoredSale);
  }

  async get(id: number): Promise<RevgasSale> {
    return this.view(this.require(id));
  }

  async list(query: ListSalesQuery = {}): Promise<Page<RevgasSale>> {
    const { page, page_size, customer_id, channel, status } = query;
    const items = [...this.sales.values()]
      .sort((a, b) => b.createdAt - a.createdAt || b.sale.id - a.sale.id)
      .map(stored => this.view(stored))
      .filter(
        sale =>
          (customer_id === undefined || sale.customer_id === customer_id) &&
          (channel === undefined || sale.channel === channel) &&
          (status === undefined || sale.status === status),
      );
    return paginate(items, { page, page_size });
  }

  async cancel(id: number, _motiveCancelSaleId?: number | null): Promise<RevgasSale> {
    const stored = this.require(id);
    stored.cancelled = true;
    return this.view(stored);
  }

  private require(id: number): StoredSale {
    const stored = this.sales.get(id);
    if (!stored) {
      throw new RevgasNotFoundError('sale not found');
    }
    return stored;
  }

  private view(stored: StoredSale): RevgasSale {
    const sale = clone(stored.sale);
    if (stored.cancelled) {
      return { ...sale, status: 'CANCEL' };
    }
    const elapsed = this.now() - stored.createdAt;
    if (elapsed < ACTIVE_AFTER_MS) {
      return sale;
    }
    const withDeliverer = {
      ...sale,
      deliverer_id: FAKE_ID_START,
      deliverer_name: 'Entregador Demo',
    };
    if (elapsed < CONFIRM_AFTER_MS) {
      return { ...withDeliverer, status: 'ACTIVE' };
    }
    return {
      ...withDeliverer,
      status: 'CONFIRM',
      delivered_at: new Date(stored.createdAt + CONFIRM_AFTER_MS).toISOString(),
    };
  }
}
