import type { Interpretation, NameReading } from 'src/modules/assistant/contracts/assistant.types';
import type { BasePrice } from 'src/modules/catalog/contracts/catalog.types';
import type { HandoffOutcome, ServiceHoursInfo } from 'src/modules/handoff/contracts/handoff.types';
import type { KnowledgeAnswer } from 'src/modules/knowledge/contracts/knowledge.types';
import type { MetricEvent } from 'src/modules/metrics/contracts/metrics.types';
import type { SaleAttemptStatus } from 'src/modules/order/contracts/order.types';
import type { FlowTools } from '../flow.types';

export const FAKE_PHONE = '5586999990000';
export const FAKE_NOW = new Date('2026-10-21T12:00:00-03:00');

export interface FakeCall {
  name: string;
  args: unknown[];
}

export type FakeTools = FlowTools & { calls: FakeCall[] };

export function createFakeTools(overrides: Partial<FlowTools> = {}): FakeTools {
  const calls: FakeCall[] = [];
  const record = <T>(name: string, value: T) => {
    return async (...args: unknown[]): Promise<T> => {
      calls.push({ name, args });
      return value;
    };
  };

  const identities = new Map<string, number>();
  const customer = { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: null };
  const addresses = [
    {
      street: 'Rua das Flores',
      number: '120',
      neighborhood: 'Centro',
      city: 'Teresina',
      state: 'PI',
    },
    {
      street: 'Av. Frei Serafim',
      number: '900',
      neighborhood: 'Centro',
      city: 'Teresina',
      state: 'PI',
    },
  ];

  const base = {
    phone: FAKE_PHONE,
    track: (event: MetricEvent) => {
      calls.push({ name: 'track', args: [event] });
    },
    findCustomer: async (phone: string) => {
      calls.push({ name: 'findCustomer', args: [phone] });
      return phone === FAKE_PHONE ? customer : null;
    },
    createCustomer: record('createCustomer', { ...customer, id: 2 }),
    customerHistory: record('customerHistory', { addresses, productIds: [2] }),
    verifiedCustomer: async (phone: string) => {
      calls.push({ name: 'verifiedCustomer', args: [phone] });
      return identities.get(phone) ?? null;
    },
    isVerified: record('isVerified', true),
    markVerified: async (phone: string, customerId: number) => {
      calls.push({ name: 'markVerified', args: [phone, customerId] });
      identities.set(phone, customerId);
    },
    registerCpfMismatch: record('registerCpfMismatch', 1),
    isBlocked: record('isBlocked', false),
    addressFromCep: record('addressFromCep', { ...addresses[0], number: undefined }),
    addressFromText: record('addressFromText', addresses[0]),
    answerQuestion: record('answerQuestion', {
      kind: 'unknown',
      reason: 'no_match',
    } as KnowledgeAnswer),
    knowledgeTopics: record('knowledgeTopics', [] as string[]),
    basePrices: record('basePrices', [] as BasePrice[]),
    registerMisunderstood: record('registerMisunderstood', 1),
    resetMisunderstood: record('resetMisunderstood', undefined),
    registerOffense: record('registerOffense', 1),
    interpret: record('interpret', null as Interpretation | null),
    readName: record('readName', null as NameReading | null),
    listProducts: record('listProducts', [
      { id: 1, name: 'Botijão P13' },
      { id: 2, name: 'Botijão P45' },
      { id: 3, name: 'Água mineral 20L' },
    ]),
    listPaymentOptions: record('listPaymentOptions', [
      { type: 'PIX', label: 'Pix' },
      { type: 'MONEY', label: 'Dinheiro' },
      { type: 'CARTAO_DE_CREDITO', label: 'Cartão de crédito' },
    ]),
    quote: async (...args: unknown[]) => {
      calls.push({ name: 'quote', args });
      const quantity = args[3] as number;
      return { unitPrice: 110, total: 110 * quantity };
    },
    latestOrderStatus: record('latestOrderStatus', null),
    createSale: record('createSale', 4521),
    saleAttemptStatus: record('saleAttemptStatus', null as SaleAttemptStatus | null),
    findRecentSale: record('findRecentSale', null as number | null),
    checkpoint: record('checkpoint', undefined),
    requestHandoff: record('requestHandoff', {
      status: 'queued',
      open: true,
      nextOpening: null,
    } as HandoffOutcome),
    serviceHours: record('serviceHours', {
      open: true,
      nextOpening: null,
      windows: [],
    } as ServiceHoursInfo),
    storePhone: '86999990000',
    demo: false,
    now: () => FAKE_NOW,
  } satisfies FlowTools;

  return { ...base, ...overrides, calls };
}
