import type {
  ListDealsQuery,
  ListProductsQuery,
  ListSalesQuery,
  Page,
  PageQuery,
  RevgasClient,
} from '../revgas.client';
import { RevgasDuplicateError, RevgasNotFoundError, RevgasValidationError } from '../revgas.errors';
import type {
  RevgasCustomer,
  RevgasCustomerInput,
  RevgasDeal,
  RevgasEstablishment,
  RevgasPaymentType,
  RevgasProduct,
  RevgasSale,
  RevgasSaleInput,
} from '../revgas.schemas';
import { parseSaleInput } from '../revgas.validation';
import {
  FAKE_CUSTOMERS,
  FAKE_DEALS,
  FAKE_ESTABLISHMENT,
  FAKE_ID_START,
  FAKE_PAYMENT_TYPES,
  FAKE_PRODUCTS,
} from './fixtures';

export { FAKE_ID_START } from './fixtures';

export type FakeRevgasOptions = {
  now?: () => number;
  seedCustomers?: RevgasCustomer[];
  dealsSource?: () => Promise<RevgasDeal[]>;
};

const ACTIVE_AFTER_MS = 2 * 60_000;
const CONFIRM_AFTER_MS = 10 * 60_000;
const DEFAULT_PAGE_SIZE = 100;

type StoredSale = { sale: RevgasSale; createdAt: number; cancelled: boolean };

const clone = <T>(value: T): T => structuredClone(value);

const digits = (value: string): string => value.replace(/\D/g, '');

const nationalNumber = (value: string): string => {
  const only = digits(value);
  return (only.length === 12 || only.length === 13) && only.startsWith('55') ? only.slice(2) : only;
};

const samePhone = (a: string, b: string): boolean => {
  const left = nationalNumber(a);
  const right = nationalNumber(b);
  if (left.length === right.length) {
    return left.length >= 10 && left.length <= 11 && left === right;
  }
  const lengths = [left.length, right.length].sort();
  return (
    lengths[0] === 10 &&
    lengths[1] === 11 &&
    left.slice(0, 2) === right.slice(0, 2) &&
    left.slice(-8) === right.slice(-8)
  );
};

function paginate<T>(items: T[], query: PageQuery = {}): Page<T> {
  const page = query.page ?? 1;
  const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
  const data = items.slice((page - 1) * pageSize, page * pageSize);
  return {
    data: clone(data),
    pagination: {
      page,
      count: data.length,
      total_count: items.length,
      page_size: pageSize,
      has_next: page * pageSize < items.length,
    },
  };
}

export class FakeRevgasClient implements RevgasClient {
  private readonly now: () => number;
  private readonly dealsSource?: () => Promise<RevgasDeal[]>;
  private readonly customers = new Map<number, RevgasCustomer>();
  private readonly sales = new Map<number, StoredSale>();
  private nextCustomerId = FAKE_ID_START + 1000;
  private nextSaleId = FAKE_ID_START + 1000;

  constructor(options: FakeRevgasOptions = {}) {
    this.now = options.now ?? Date.now;
    this.dealsSource = options.dealsSource;
    const seeds = [...FAKE_CUSTOMERS, ...(options.seedCustomers ?? [])];
    for (const customer of seeds) {
      this.customers.set(customer.id, clone(customer));
      if (customer.id >= this.nextCustomerId) {
        this.nextCustomerId = customer.id + 1;
      }
    }
  }

  ownsSale(id: number): boolean {
    return id >= FAKE_ID_START && this.sales.has(id);
  }

  ownsCustomer(id: number): boolean {
    return id >= FAKE_ID_START && this.customers.has(id);
  }

  async listEstablishments(): Promise<Page<RevgasEstablishment>> {
    return paginate([FAKE_ESTABLISHMENT]);
  }

  async listProducts(query: ListProductsQuery = {}): Promise<Page<RevgasProduct>> {
    const { page, page_size, inactive, description } = query;
    const items = FAKE_PRODUCTS.filter(
      product =>
        (inactive === undefined || Boolean(product.inactive) === inactive) &&
        (!description || product.description.toLowerCase().includes(description.toLowerCase())),
    );
    return paginate(items, { page, page_size });
  }

  async listDeals(query: ListDealsQuery = {}): Promise<Page<RevgasDeal>> {
    const { page, page_size, ...filters } = query;
    return paginate(this.filterDeals(filters), { page, page_size });
  }

  async listAllDeals(
    query: Omit<ListDealsQuery, 'page' | 'page_size'> = {},
  ): Promise<RevgasDeal[]> {
    return clone(this.filterDeals(query));
  }

  async listPaymentTypes(): Promise<RevgasPaymentType[]> {
    if (!this.dealsSource) {
      return clone(FAKE_PAYMENT_TYPES);
    }
    const unique = new Map<number, RevgasPaymentType>();
    for (const deal of await this.dealsSource()) {
      const id = deal.payment_type_establishment_id;
      if (id !== null && id !== undefined && !unique.has(id)) {
        unique.set(id, { id, payment_type: deal.payment_type, status: 'ACTIVE' });
      }
    }
    return [...unique.values()];
  }

  async findCustomersByPhone(phone: string): Promise<RevgasCustomer[]> {
    return clone(
      [...this.customers.values()].filter(customer =>
        (customer.phones ?? []).some(candidate => samePhone(candidate, phone)),
      ),
    );
  }

  async getCustomer(id: number): Promise<RevgasCustomer> {
    return clone(this.requireCustomer(id));
  }

  async createCustomer(input: RevgasCustomerInput): Promise<RevgasCustomer> {
    const phones = input.phones ?? [];
    if (phones.some(phone => ![12, 13].includes(digits(phone).length))) {
      throw new RevgasValidationError('invalid customer input', [
        { field: 'phones', message: 'phones must have 12 or 13 digits' },
      ]);
    }
    for (const phone of phones) {
      const existing = [...this.customers.values()].find(customer =>
        (customer.phones ?? []).some(candidate => samePhone(candidate, phone)),
      );
      if (existing) {
        throw new RevgasDuplicateError('duplicate object', existing.id);
      }
    }
    const customer: RevgasCustomer = { ...clone(input), id: this.nextCustomerId++ };
    this.customers.set(customer.id, customer);
    return clone(customer);
  }

  async updateCustomer(id: number, input: RevgasCustomerInput): Promise<RevgasCustomer> {
    const current = this.requireCustomer(id);
    const updated: RevgasCustomer = { ...current, ...clone(input), id };
    this.customers.set(id, updated);
    return clone(updated);
  }

  async createSale(input: RevgasSaleInput): Promise<RevgasSale> {
    const parsed = parseSaleInput(input);
    const createdAt = this.now();
    const customer = parsed.customer_id ? this.customers.get(parsed.customer_id) : undefined;
    const sale: RevgasSale = {
      id: this.nextSaleId++,
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

  async getSale(id: number): Promise<RevgasSale> {
    return this.view(this.requireSale(id));
  }

  async listSales(query: ListSalesQuery = {}): Promise<Page<RevgasSale>> {
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

  async cancelSale(id: number, _motiveCancelSaleId?: number | null): Promise<RevgasSale> {
    const stored = this.requireSale(id);
    stored.cancelled = true;
    return this.view(stored);
  }

  private filterDeals(filters: Omit<ListDealsQuery, 'page' | 'page_size'>): RevgasDeal[] {
    return FAKE_DEALS.filter(
      deal =>
        (filters.product_id === undefined || deal.product_id === filters.product_id) &&
        (filters.customer_id === undefined || deal.customer_id === filters.customer_id) &&
        (filters.tag_id === undefined || deal.tag_id === filters.tag_id) &&
        (filters.payment_type === undefined || deal.payment_type === filters.payment_type),
    );
  }

  private requireCustomer(id: number): RevgasCustomer {
    const customer = this.customers.get(id);
    if (!customer) {
      throw new RevgasNotFoundError('customer not found');
    }
    return customer;
  }

  private requireSale(id: number): StoredSale {
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
