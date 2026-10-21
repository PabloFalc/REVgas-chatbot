import { Inject, Injectable } from '@nestjs/common';
import { env } from 'src/config/env';
import { RedisService } from 'src/infra/cache/redis.service';
import type { RevgasDeal } from 'src/integrations/revgas/deals/deals.schemas';
import type { RevgasEstablishment } from 'src/integrations/revgas/establishments/establishments.schemas';
import type { RevgasPaymentType } from 'src/integrations/revgas/payment-types/payment-types.schemas';
import type { RevgasProduct } from 'src/integrations/revgas/products/products.schemas';
import { REVGAS_CLIENT, type RevgasClient } from 'src/integrations/revgas/revgas.client';
import type { PaymentOption, PriceCustomer, Product, Quote } from './contracts/catalog.types';
import { paymentLabel } from './payment-labels';
import { pickDeal } from './price';

const CACHE_PREFIX = 'catalog';
const CACHE_TTL_SECONDS = 600;
const PRODUCTS_PAGE_SIZE = 100;
const ACTIVE_STATUS = 'ACTIVE';

@Injectable()
export class CatalogRepository {
  constructor(
    @Inject(REVGAS_CLIENT) private readonly revgas: RevgasClient,
    private readonly cache: RedisService,
  ) {}

  async listProducts(customer: PriceCustomer): Promise<Product[]> {
    const [products, deals, paymentTypes, establishment] = await Promise.all([
      this.products(),
      this.deals(),
      this.paymentTypes(),
      this.establishment(),
    ]);
    const activeTypes = this.activeTypes(paymentTypes);
    const ignoreStock = establishment?.ignore_stock_check === true;

    return products
      .filter(product => product.inactive !== true)
      .filter(product => ignoreStock || (product.stock_quantity ?? 0) > 0)
      .filter(product =>
        activeTypes.some(type => pickDeal(deals, product.id, type, customer) !== null),
      )
      .map(product => ({ id: product.id, name: product.description }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async listPaymentOptions(): Promise<PaymentOption[]> {
    const paymentTypes = await this.paymentTypes();
    return this.activeTypes(paymentTypes).map(type => ({
      type,
      label: paymentLabel(type),
    }));
  }

  async quote(
    customer: PriceCustomer,
    productId: number,
    paymentType: string,
    quantity: number,
  ): Promise<Quote | null> {
    const deals = await this.deals();
    const deal = pickDeal(deals, productId, paymentType, customer);
    if (!deal) return null;
    const unitPrice = deal.suggested_value;
    return { unitPrice, total: Math.round(unitPrice * quantity * 100) / 100 };
  }

  private activeTypes(paymentTypes: RevgasPaymentType[]): string[] {
    return paymentTypes
      .filter(item => item.status === ACTIVE_STATUS)
      .map(item => item.payment_type);
  }

  private products(): Promise<RevgasProduct[]> {
    return this.cached('products', async () => {
      const all: RevgasProduct[] = [];
      for (let page = 1; ; page++) {
        const result = await this.revgas.products.list({
          inactive: false,
          page,
          page_size: PRODUCTS_PAGE_SIZE,
        });
        all.push(...result.data);
        if (!result.pagination.has_next) return all;
      }
    });
  }

  private paymentTypes(): Promise<RevgasPaymentType[]> {
    return this.cached('payment-types', () => this.revgas.paymentTypes.list());
  }

  private deals(): Promise<RevgasDeal[]> {
    return this.cached('deals', () => this.revgas.deals.listAll());
  }

  private establishment(): Promise<RevgasEstablishment | null> {
    return this.cached('establishment', async () => {
      const page = await this.revgas.establishments.list();
      const wanted = env.REVGAS_ESTABLISHMENT_ID;
      const found =
        wanted === undefined ? page.data[0] : page.data.find(item => item.id === wanted);
      return found ?? null;
    });
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = await this.cache.get<T>({ prefix: CACHE_PREFIX, key });
    if (hit !== null) return hit;
    const value = await load();
    await this.cache.set({ prefix: CACHE_PREFIX, key, value, ttl: CACHE_TTL_SECONDS });
    return value;
  }
}
