import type {
  Address,
  AddressDraft,
  AddressField,
} from 'src/modules/address/contracts/address.types';
import type {
  Interpretation,
  InterpretContext,
} from 'src/modules/assistant/contracts/assistant.types';
import type {
  PaymentOption,
  PriceCustomer,
  Product,
  Quote,
} from 'src/modules/catalog/contracts/catalog.types';
import type {
  Customer,
  CustomerHistory,
  NewCustomer,
} from 'src/modules/customer/contracts/customer.types';
import type { SaleOrder } from 'src/modules/order/contracts/order.types';
import type { IncomingContent, Reply } from '../contracts/conversation.types';

export type Step =
  | 'askName'
  | 'askCpf'
  | 'askMissingCpf'
  | 'chooseAddress'
  | 'askNewAddress'
  | 'askAddressField'
  | 'confirmAddress'
  | 'chooseProduct'
  | 'searchProduct'
  | 'chooseQuantity'
  | 'askQuantity'
  | 'choosePayment'
  | 'askNeedsChange'
  | 'askChangeAmount'
  | 'summary'
  | 'chooseCorrection'
  | 'creatingSale'
  | 'saleFailed';

export interface OrderState {
  step: Step;
  customer: { id?: number; name?: string; cpf?: string; tagId?: number | null };
  addresses?: Address[];
  boughtProductIds?: number[];
  draftAddress?: AddressDraft;
  missingField?: AddressField;
  address?: Address;
  productOptions?: Product[];
  product?: Product;
  quantity?: number;
  paymentOptions?: PaymentOption[];
  payment?: PaymentOption;
  quote?: Quote;
  changeFor?: number | null;
  saleAttemptAt?: string;
}

export interface FlowInput {
  phone: string;
  content: IncomingContent;
}

export interface StepResult {
  state: OrderState | null;
  replies: Reply[];
  saleId?: number;
}

export type AskFn = (state: OrderState, tools: FlowTools) => Promise<StepResult>;

export type HandleFn = (
  state: OrderState,
  input: FlowInput,
  tools: FlowTools,
) => Promise<StepResult>;

export interface FlowTools {
  findCustomer(phone: string): Promise<Customer | null>;
  createCustomer(input: NewCustomer): Promise<Customer>;
  saveCpf(customerId: number, cpf: string): Promise<void>;
  customerHistory(customerId: number): Promise<CustomerHistory>;
  addressFromCep(cep: string): Promise<AddressDraft | null>;
  addressFromText(text: string): Promise<AddressDraft | null>;
  interpret(text: string, context: InterpretContext): Promise<Interpretation | null>;
  listProducts(customer: PriceCustomer): Promise<Product[]>;
  listPaymentOptions(): Promise<PaymentOption[]>;
  quote(
    customer: PriceCustomer,
    productId: number,
    paymentType: string,
    quantity: number,
  ): Promise<Quote | null>;
  createSale(order: SaleOrder): Promise<number>;
  findRecentSale(order: SaleOrder, since: Date): Promise<number | null>;
  checkpoint(state: OrderState): Promise<void>;
  storePhone?: string;
  now(): Date;
}

export class ToolError extends Error {
  constructor(cause: unknown) {
    super('Flow tool failed', { cause });
    this.name = 'ToolError';
  }
}
