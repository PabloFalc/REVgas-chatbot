import type { PriceCustomer, Product } from 'src/modules/catalog/contracts/catalog.types';
import { normalizeText } from 'src/utils/text';
import type { AskFn, FlowTools, HandleFn, OrderState, Step, StepResult } from '../flow.types';
import { choiceOf, textOf } from '../input';
import { msg } from '../messages';
import { nextStep } from '../next-step';
import { buttons, list, text } from '../replies';

const LIST_LIMIT = 10;
const LIST_PRODUCT_LIMIT = 9;

function priceCustomer(state: OrderState): PriceCustomer {
  return { id: state.customer.id, tagId: state.customer.tagId };
}

function ordered(products: Product[], boughtIds: number[] = []): Product[] {
  const bought = boughtIds
    .map(id => products.find(product => product.id === id))
    .filter((product): product is Product => product !== undefined);
  const boughtSet = new Set(bought.map(product => product.id));
  return [...bought, ...products.filter(product => !boughtSet.has(product.id))];
}

async function loadOptions(state: OrderState, tools: FlowTools): Promise<Product[]> {
  if (state.productOptions) return state.productOptions;
  const products = await tools.listProducts(priceCustomer(state));
  return ordered(products, state.boughtProductIds);
}

function showProducts(
  state: OrderState,
  step: Step,
  products: Product[],
  withSearch: boolean,
): StepResult {
  const rows = products.map(product => ({ id: `product:${product.id}`, title: product.name }));
  const shown =
    withSearch && rows.length > LIST_LIMIT
      ? [...rows.slice(0, LIST_PRODUCT_LIMIT), { id: 'product:search', title: msg.searchByName }]
      : rows;
  return {
    state: { ...state, step },
    replies: [list(msg.chooseProduct, msg.viewProducts, shown)],
  };
}

const chooseProduct: AskFn = async (state, tools) => {
  const products = ordered(await tools.listProducts(priceCustomer(state)), state.boughtProductIds);
  if (products.length === 0) return { state, replies: [text(msg.unavailable)] };
  return showProducts({ ...state, productOptions: products }, 'chooseProduct', products, true);
};

const searchProduct: AskFn = async state => ({
  state: { ...state, step: 'searchProduct' },
  replies: [text(msg.askProductSearch)],
});

function selectProduct(state: OrderState, product: Product, tools: FlowTools): Promise<StepResult> {
  const { quantity: _quantity, quote: _quote, ...rest } = state;
  return nextStep({ ...rest, product }, tools);
}

function findChosen(state: OrderState, choice: string | null): Product | undefined {
  if (choice === null || !/^\d+$/.test(choice)) return undefined;
  return state.productOptions?.find(product => product.id === Number(choice));
}

const handleChooseProduct: HandleFn = async (state, input, tools) => {
  const choice = choiceOf(input, 'product');
  if (choice === 'search') return searchProduct(state, tools);
  const product = findChosen(state, choice);
  if (product) return selectProduct(state, product, tools);
  return chooseProduct(state, tools);
};

const handleSearchProduct: HandleFn = async (state, input, tools) => {
  const product = findChosen(state, choiceOf(input, 'product'));
  if (product) return selectProduct(state, product, tools);

  const query = textOf(input);
  if (query === null || !normalizeText(query)) return searchProduct(state, tools);

  const options = await loadOptions(state, tools);
  const needle = normalizeText(query);
  const found = options.filter(item => normalizeText(item.name).includes(needle));
  const next = { ...state, productOptions: options };
  if (found.length === 0) {
    return { state: { ...next, step: 'searchProduct' }, replies: [text(msg.productNotFound)] };
  }
  return showProducts(next, 'searchProduct', found, false);
};

const chooseQuantity: AskFn = async state => ({
  state: { ...state, step: 'chooseQuantity' },
  replies: [
    buttons(msg.chooseQuantity(state.product as Product), [
      { id: 'qty:1', title: '1' },
      { id: 'qty:2', title: '2' },
      { id: 'qty:other', title: msg.otherQuantity },
    ]),
  ],
});

const askQuantity: AskFn = async state => ({
  state: { ...state, step: 'askQuantity' },
  replies: [text(msg.askQuantity)],
});

function setQuantity(state: OrderState, quantity: number, tools: FlowTools): Promise<StepResult> {
  const { quote: _quote, ...rest } = state;
  return nextStep({ ...rest, quantity }, tools);
}

const handleChooseQuantity: HandleFn = async (state, input, tools) => {
  const choice = choiceOf(input, 'qty');
  if (choice === 'other') return askQuantity(state, tools);
  if (choice === '1' || choice === '2') return setQuantity(state, Number(choice), tools);
  return chooseQuantity(state, tools);
};

const handleAskQuantity: HandleFn = async (state, input, tools) => {
  const raw = textOf(input)?.trim();
  if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) < 1) {
    return { state, replies: [text(msg.invalidQuantity)] };
  }
  return setQuantity(state, Number(raw), tools);
};

export const asks: Partial<Record<Step, AskFn>> = {
  chooseProduct,
  searchProduct,
  chooseQuantity,
  askQuantity,
};

export const handlers: Partial<Record<Step, HandleFn>> = {
  chooseProduct: handleChooseProduct,
  searchProduct: handleSearchProduct,
  chooseQuantity: handleChooseQuantity,
  askQuantity: handleAskQuantity,
};
