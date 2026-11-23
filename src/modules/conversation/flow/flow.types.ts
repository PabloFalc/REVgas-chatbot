import type {
  Address,
  AddressDraft,
  AddressField,
} from 'src/modules/address/contracts/address.types';
import type {
  Interpretation,
  InterpretContext,
  NameReading,
} from 'src/modules/assistant/contracts/assistant.types';
import type {
  BasePrice,
  PaymentOption,
  PriceCustomer,
  Product,
  Quote,
} from 'src/modules/catalog/contracts/catalog.types';
import type {
  Customer,
  CustomerHistory,
  LastOrder,
  NewCustomer,
} from 'src/modules/customer/contracts/customer.types';
import type {
  HandoffOutcome,
  HandoffRequest,
  ServiceHoursInfo,
} from 'src/modules/handoff/contracts/handoff.types';
import type { KnowledgeAnswer } from 'src/modules/knowledge/contracts/knowledge.types';
import type { OrderStatus, SaleOrder } from 'src/modules/order/contracts/order.types';
import type { IncomingContent, Reply } from '../contracts/conversation.types';

export const MAX_CPF_ATTEMPTS = 3;
export const MAX_QUANTITY = 10;

export type Step =
  | 'askName'
  | 'askCpf'
  | 'askCpfPrefix'
  | 'offerRepeat'
  | 'chooseAddress'
  | 'askNewAddress'
  | 'askAddressField'
  | 'confirmAddress'
  | 'chooseProduct'
  | 'searchProduct'
  | 'pickProduct'
  | 'chooseQuantity'
  | 'askQuantity'
  | 'choosePayment'
  | 'askNeedsChange'
  | 'askChangeAmount'
  | 'summary'
  | 'chooseCorrection'
  | 'creatingSale'
  | 'saleFailed';

export const CPF_STEPS: readonly Step[] = ['askCpf', 'askCpfPrefix'];

export interface RepeatOffer {
  product: Product;
  quantity: number;
  payment: PaymentOption;
  address: Address;
  quote: Quote;
}

export interface OrderState {
  step: Step;
  pendingOrderStatus?: { resumeStep: Step | null; customer: OrderState['customer'] };
  customer: {
    id?: number;
    name?: string;
    cpf?: string;
    cpfPrefix?: string;
    tagId?: number | null;
  };
  addresses?: Address[];
  boughtProductIds?: number[];
  lastOrder?: LastOrder;
  repeatOffer?: RepeatOffer;
  draftAddress?: AddressDraft;
  missingField?: AddressField;
  address?: Address;
  productOptions?: Product[];
  productCandidates?: Product[];
  pendingAddressText?: string;
  product?: Product;
  quantity?: number;
  paymentOptions?: PaymentOption[];
  payment?: PaymentOption;
  quote?: Quote;
  changeFor?: number | null;
  saleAttemptAt?: string;
  lastInboundAt?: string;
  remindedFor?: string;
}

export interface FlowInput {
  phone: string;
  content: IncomingContent;
}

export interface StepResult {
  state: OrderState | null;
  replies: Reply[];
  saleId?: number;
  misunderstood?: true;
}

export type AskFn = (state: OrderState, tools: FlowTools) => Promise<StepResult>;

export type HandleFn = (
  state: OrderState,
  input: FlowInput,
  tools: FlowTools,
) => Promise<StepResult>;

export interface FlowTools {
  phone: string;
  findCustomer(phone: string): Promise<Customer | null>;
  createCustomer(input: NewCustomer): Promise<Customer>;
  customerHistory(customerId: number): Promise<CustomerHistory>;
  isVerified(phone: string, customerId: number): Promise<boolean>;
  markVerified(phone: string, customerId: number): Promise<void>;
  registerCpfMismatch(phone: string): Promise<number>;
  isBlocked(phone: string): Promise<boolean>;
  registerMisunderstood(): Promise<number>;
  resetMisunderstood(): Promise<void>;
  registerOffense(): Promise<number>;
  addressFromCep(cep: string): Promise<AddressDraft | null>;
  addressFromText(text: string): Promise<AddressDraft | null>;
  interpret(text: string, context: InterpretContext): Promise<Interpretation | null>;
  readName(text: string): Promise<NameReading | null>;
  answerQuestion(text: string): Promise<KnowledgeAnswer>;
  knowledgeTopics(): Promise<string[]>;
  listProducts(customer: PriceCustomer): Promise<Product[]>;
  basePrices(customer?: PriceCustomer): Promise<BasePrice[]>;
  listPaymentOptions(): Promise<PaymentOption[]>;
  quote(
    customer: PriceCustomer,
    productId: number,
    paymentType: string,
    quantity: number,
  ): Promise<Quote | null>;
  latestOrderStatus(customerId: number, now: Date): Promise<OrderStatus | null>;
  createSale(order: SaleOrder): Promise<number>;
  findRecentSale(order: SaleOrder, since: Date): Promise<number | null>;
  checkpoint(state: OrderState): Promise<void>;
  requestHandoff(request: HandoffRequest): Promise<HandoffOutcome>;
  serviceHours(): Promise<ServiceHoursInfo>;
  storePhone?: string;
  now(): Date;
}

export class ToolError extends Error {
  constructor(cause: unknown) {
    super('Flow tool failed', { cause });
    this.name = 'ToolError';
  }
}
