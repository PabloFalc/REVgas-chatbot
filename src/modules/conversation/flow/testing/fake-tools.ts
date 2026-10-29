import type { Interpretation } from 'src/modules/assistant/contracts/assistant.types';
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
    findCustomer: async (phone: string) => {
      calls.push({ name: 'findCustomer', args: [phone] });
      return phone === FAKE_PHONE ? customer : null;
    },
    createCustomer: record('createCustomer', { ...customer, id: 2 }),
    customerHistory: record('customerHistory', { addresses, productIds: [2] }),
    isVerified: record('isVerified', true),
    markVerified: record('markVerified', undefined),
    registerCpfMismatch: record('registerCpfMismatch', 1),
    isBlocked: record('isBlocked', false),
    addressFromCep: record('addressFromCep', { ...addresses[0], number: undefined }),
    addressFromText: record('addressFromText', addresses[0]),
    interpret: record('interpret', null as Interpretation | null),
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
    createSale: record('createSale', 4521),
    findRecentSale: record('findRecentSale', null as number | null),
    checkpoint: record('checkpoint', undefined),
    storePhone: '86999990000',
    now: () => FAKE_NOW,
  } satisfies FlowTools;

  return { ...base, ...overrides, calls };
}
