import type { PaymentOption } from 'src/modules/catalog/contracts/catalog.types';
import { parseMoney } from 'src/utils/money';
import { normalizeText } from 'src/utils/text';
import type { AskFn, HandleFn, Step } from '../flow.types';
import { freeText, freeTextOr } from '../free-text';
import { choiceOf, textOf } from '../input';
import { msg } from '../messages';
import { nextStep } from '../next-step';
import { buttons, list, text } from '../replies';

const BUTTON_LIMIT = 3;
const CHANGE_FILLERS = new Set(['reais', 'real', 'pra', 'para', 'troco', 'de', 'o', 'os', 'e']);

const MONEY_TEXT = /^\s*(?:r\$)?[\s\d.,]*$/i;
const MONEY_TOKEN = /^\d[\d.,]*$/;

function parseChange(raw: string): number | null {
  if (MONEY_TEXT.test(raw)) return parseMoney(raw);
  const words = normalizeText(raw)
    .replace(/r\$/g, ' ')
    .split(/\s+/)
    .filter(word => word && !CHANGE_FILLERS.has(word));
  if (words.length !== 1 || !MONEY_TOKEN.test(words[0])) return null;
  return parseMoney(words[0]);
}

const choosePayment: AskFn = async (state, tools) => {
  const options = await tools.listPaymentOptions();
  if (options.length === 0) return { state, replies: [text(msg.unavailable)] };
  const next = { ...state, step: 'choosePayment' as Step, paymentOptions: options };
  const entries = options.map(option => ({ id: `pay:${option.type}`, title: option.label }));
  const reply =
    options.length <= BUTTON_LIMIT
      ? buttons(msg.choosePayment, entries)
      : list(msg.choosePayment, msg.viewPayments, entries);
  return { state: next, replies: [reply] };
};

const handleChoosePayment: HandleFn = async (state, input, tools) => {
  const choice = choiceOf(input, 'pay');
  const payment: PaymentOption | undefined =
    choice === null ? undefined : state.paymentOptions?.find(option => option.type === choice);
  if (!payment) {
    const raw = textOf(input);
    if (raw !== null) return freeText(state, raw, tools);
    return choosePayment(state, tools);
  }
  const { quote: _quote, changeFor: _changeFor, ...rest } = state;
  return nextStep({ ...rest, payment }, tools);
};

const askNeedsChange: AskFn = async state => ({
  state: { ...state, step: 'askNeedsChange' },
  replies: [
    buttons(msg.askNeedsChange(state.quote?.total ?? 0), [
      { id: 'change:no', title: msg.noChangeNeeded },
      { id: 'change:yes', title: msg.needsChange },
    ]),
  ],
});

const askChangeAmount: AskFn = async state => ({
  state: { ...state, step: 'askChangeAmount' },
  replies: [text(msg.askChangeAmount)],
});

const handleAskNeedsChange: HandleFn = async (state, input, tools) => {
  const choice = choiceOf(input, 'change');
  if (choice === 'no') return nextStep({ ...state, changeFor: null }, tools);
  if (choice === 'yes') return askChangeAmount(state, tools);
  const raw = textOf(input);
  if (raw !== null) return freeText(state, raw, tools);
  return askNeedsChange(state, tools);
};

const handleAskChangeAmount: HandleFn = async (state, input, tools) => {
  const total = state.quote?.total ?? 0;
  const raw = textOf(input);
  const amount = raw === null ? null : parseChange(raw);
  if (amount === null) return freeTextOr(state, raw, tools, msg.invalidChange(total));
  if (amount <= total) return { state, replies: [text(msg.invalidChange(total))] };
  return nextStep({ ...state, changeFor: amount }, tools);
};

export const asks: Partial<Record<Step, AskFn>> = {
  choosePayment,
  askNeedsChange,
  askChangeAmount,
};

export const handlers: Partial<Record<Step, HandleFn>> = {
  choosePayment: handleChoosePayment,
  askNeedsChange: handleAskNeedsChange,
  askChangeAmount: handleAskChangeAmount,
};
