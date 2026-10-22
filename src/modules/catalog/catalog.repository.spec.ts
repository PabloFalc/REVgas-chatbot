import type { RedisService } from 'src/infra/cache/redis.service';
import type { RevgasDeal } from 'src/integrations/revgas/deals/deals.schemas';
import type { RevgasEstablishment } from 'src/integrations/revgas/establishments/establishments.schemas';
import type { RevgasPaymentType } from 'src/integrations/revgas/payment-types/payment-types.schemas';
import type { RevgasProduct } from 'src/integrations/revgas/products/products.schemas';
import type { RevgasClient } from 'src/integrations/revgas/revgas.client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogRepository } from './catalog.repository';

const envMock = vi.hoisted(() => ({ REVGAS_ESTABLISHMENT_ID: undefined as number | undefined }));
vi.mock('src/config/env', () => ({ env: envMock }));

const product = (id: number, description: string, extra: Partial<RevgasProduct> = {}) =>
  ({ id, description, stock_quantity: 10, inactive: false, ...extra }) as RevgasProduct;

const deal = (id: number, productId: number, paymentType: string, value: number) =>
  ({
    id,
    product_id: productId,
    suggested_value: value,
    minimum_value: 0,
    payment_type: paymentType,
    type: 'PAYMENT_TYPE',
    is_default: true,
  }) as RevgasDeal;

const payment = (id: number, type: string, status = 'ACTIVE') =>
  ({ id, payment_type: type, status }) as RevgasPaymentType;

interface Data {
  products: RevgasProduct[];
  deals: RevgasDeal[];
  paymentTypes: RevgasPaymentType[];
  establishments: RevgasEstablishment[];
}

const build = (data: Partial<Data> = {}) => {
  const full: Data = {
    products: [],
    deals: [],
    paymentTypes: [payment(1, 'PIX')],
    establishments: [{ id: 1, ignore_stock_check: false }],
    ...data,
  };
  const productsList = vi.fn(async (query?: { page?: number; page_size?: number }) => {
    const size = query?.page_size ?? 100;
    const page = query?.page ?? 1;
    const slice = full.products.slice((page - 1) * size, page * size);
    return {
      data: slice,
      pagination: {
        page,
        count: slice.length,
        total_count: full.products.length,
        has_next: page * size < full.products.length,
      },
    };
  });
  const dealsListAll = vi.fn(async () => full.deals);
  const paymentTypesList = vi.fn(async () => full.paymentTypes);
  const establishmentsList = vi.fn(async () => ({
    data: full.establishments,
    pagination: {
      page: 1,
      count: full.establishments.length,
      total_count: full.establishments.length,
    },
  }));
  const client = {
    products: { list: productsList },
    deals: { listAll: dealsListAll },
    paymentTypes: { list: paymentTypesList },
    establishments: { list: establishmentsList },
  } as unknown as RevgasClient;
  const store = new Map<string, unknown>();
  const cache = {
    get: vi.fn(
      async ({ prefix, key }: { prefix: string; key: string }) =>
        store.get(`${prefix}:${key}`) ?? null,
    ),
    set: vi.fn(async ({ prefix, key, value }: { prefix: string; key: string; value: unknown }) => {
      store.set(`${prefix}:${key}`, JSON.parse(JSON.stringify(value)));
    }),
  } as unknown as RedisService;
  return {
    repository: new CatalogRepository(client, cache),
    cache,
    productsList,
    dealsListAll,
    paymentTypesList,
    establishmentsList,
  };
};

describe('CatalogRepository', () => {
  beforeEach(() => {
    envMock.REVGAS_ESTABLISHMENT_ID = undefined;
  });

  describe('listProducts', () => {
    it('hides inactive, out-of-stock and products without an applicable deal, sorted by name', async () => {
      const { repository } = build({
        products: [
          product(1, 'P13'),
          product(2, 'Água'),
          product(3, 'Inativo', { inactive: true }),
          product(4, 'Sem estoque', { stock_quantity: 0 }),
          product(5, 'Sem acordo'),
          product(6, 'Estoque nulo', { stock_quantity: null }),
        ],
        deals: [
          deal(1, 1, 'PIX', 100),
          deal(2, 2, 'PIX', 20),
          deal(3, 3, 'PIX', 1),
          deal(4, 4, 'PIX', 1),
          deal(6, 6, 'PIX', 1),
          deal(7, 5, 'MONEY', 1),
        ],
      });

      expect(await repository.listProducts({})).toEqual([
        { id: 2, name: 'Água' },
        { id: 1, name: 'P13' },
      ]);
    });

    it('ignores deals of inactive payment types', async () => {
      const { repository } = build({
        products: [product(1, 'P13')],
        deals: [deal(1, 1, 'MONEY', 100)],
        paymentTypes: [payment(1, 'PIX'), payment(2, 'MONEY', 'INACTIVE')],
      });

      expect(await repository.listProducts({})).toEqual([]);
    });

    it('shows products without stock when the establishment ignores the stock check', async () => {
      const { repository } = build({
        products: [product(1, 'P13', { stock_quantity: 0 })],
        deals: [deal(1, 1, 'PIX', 100)],
        establishments: [{ id: 1, ignore_stock_check: true }],
      });

      expect(await repository.listProducts({})).toEqual([{ id: 1, name: 'P13' }]);
    });

    it('uses the establishment from the env when defined', async () => {
      envMock.REVGAS_ESTABLISHMENT_ID = 2;
      const { repository } = build({
        products: [product(1, 'P13', { stock_quantity: 0 })],
        deals: [deal(1, 1, 'PIX', 100)],
        establishments: [
          { id: 1, ignore_stock_check: false },
          { id: 2, ignore_stock_check: true },
        ],
      });

      expect(await repository.listProducts({})).toEqual([{ id: 1, name: 'P13' }]);
    });

    it('uses the first establishment when the env is not defined', async () => {
      const { repository } = build({
        products: [product(1, 'P13', { stock_quantity: 0 })],
        deals: [deal(1, 1, 'PIX', 100)],
        establishments: [
          { id: 1, ignore_stock_check: false },
          { id: 2, ignore_stock_check: true },
        ],
      });

      expect(await repository.listProducts({})).toEqual([]);
    });

    it('paginates through every products page', async () => {
      const products = Array.from({ length: 250 }, (_, index) =>
        product(index + 1, `Produto ${String(index + 1).padStart(3, '0')}`),
      );
      const { repository, productsList } = build({
        products,
        deals: products.map(item => deal(item.id, item.id, 'PIX', 10)),
      });

      expect(await repository.listProducts({})).toHaveLength(250);
      expect(productsList).toHaveBeenCalledTimes(3);
    });
  });

  describe('listPaymentOptions', () => {
    it('returns only active payment types with their labels', async () => {
      const { repository } = build({
        paymentTypes: [payment(1, 'PIX'), payment(2, 'MONEY', 'INACTIVE'), payment(3, 'VALEGAS')],
      });

      expect(await repository.listPaymentOptions()).toEqual([
        { type: 'PIX', label: 'Pix' },
        { type: 'VALEGAS', label: 'Vale-gás' },
      ]);
    });
  });

  describe('quote', () => {
    it('uses the suggested value and rounds the total to cents', async () => {
      const { repository } = build({ deals: [deal(1, 1, 'PIX', 33.333)] });

      expect(await repository.quote({}, 1, 'PIX', 3)).toEqual({ unitPrice: 33.333, total: 100 });
    });

    it('returns null when there is no applicable deal', async () => {
      const { repository } = build({ deals: [deal(1, 1, 'PIX', 100)] });

      expect(await repository.quote({}, 1, 'MONEY', 1)).toBeNull();
    });
  });

  describe('cache', () => {
    it('does not call RevGás again on the second call', async () => {
      const {
        repository,
        productsList,
        dealsListAll,
        paymentTypesList,
        establishmentsList,
        cache,
      } = build({ products: [product(1, 'P13')], deals: [deal(1, 1, 'PIX', 100)] });

      await repository.listProducts({});
      await repository.listProducts({});
      await repository.listPaymentOptions();
      await repository.quote({}, 1, 'PIX', 1);

      expect(productsList).toHaveBeenCalledTimes(1);
      expect(dealsListAll).toHaveBeenCalledTimes(1);
      expect(paymentTypesList).toHaveBeenCalledTimes(1);
      expect(establishmentsList).toHaveBeenCalledTimes(1);
      const keys = vi
        .mocked(cache.set)
        .mock.calls.map(([params]) => `${params.prefix}:${params.key}`);
      expect(keys.sort()).toEqual([
        'catalog:deals',
        'catalog:establishment',
        'catalog:payment-types',
        'catalog:products',
      ]);
      expect(vi.mocked(cache.set).mock.calls.every(([params]) => params.ttl === 600)).toBe(true);
    });
  });
});
