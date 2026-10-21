import type {
  Address,
  AddressDraft,
  AddressField,
} from 'src/modules/address/contracts/address.types';
import {
  CpfTakenError,
  CustomerRejectedError,
} from 'src/modules/customer/contracts/customer.types';
import type { AskFn, FlowTools, HandleFn, OrderState, Step, StepResult } from '../flow.types';
import { choiceOf, textOf } from '../input';
import { msg } from '../messages';
import { nextStep } from '../next-step';
import { buttons, list, text } from '../replies';

const CEP_PATTERN = /^\s*\d{5}-?\d{3}\s*$/;
const NUMBER_PATTERN = /^(\d+[a-zA-Z]?)\s*[,-]?\s*(.*)$/;
const NO_NUMBER_PATTERN = /^\s*s\s*\/?\s*n\s*$/i;
const BUTTON_LIMIT = 2;
const LIST_ADDRESS_LIMIT = 9;
const FIELD_ORDER: AddressField[] = ['street', 'number', 'neighborhood'];

const FIELD_QUESTIONS: Record<AddressField, string> = {
  street: msg.askStreet,
  number: msg.askNumber,
  neighborhood: msg.askNeighborhood,
};

function missingFieldOf(draft: AddressDraft): AddressField | undefined {
  return FIELD_ORDER.find(field => !draft[field]);
}

function numbered(addresses: Address[]): string {
  return addresses.map((address, index) => `${index + 1}. ${msg.addressFull(address)}`).join('\n');
}

function withoutDraft(state: OrderState): OrderState {
  const { draftAddress: _draft, missingField: _missing, ...rest } = state;
  return rest;
}

const chooseAddress: AskFn = async state => {
  const addresses = state.addresses ?? [];
  const next = { ...state, step: 'chooseAddress' as Step };
  if (addresses.length <= BUTTON_LIMIT) {
    const options = addresses.map((address, index) => ({
      id: `address:${index}`,
      title: msg.addressLabel(address),
    }));
    const body = `${msg.chooseAddress}\n${numbered(addresses)}`;
    return {
      state: next,
      replies: [buttons(body, [...options, { id: 'address:new', title: msg.otherAddress }])],
    };
  }
  const rows = [
    ...addresses.slice(0, LIST_ADDRESS_LIMIT).map((address, index) => ({
      id: `address:${index}`,
      title: msg.addressLabel(address),
      description: msg.addressFull(address),
    })),
    { id: 'address:new', title: msg.otherAddress },
  ];
  return { state: next, replies: [list(msg.chooseAddress, msg.viewAddresses, rows)] };
};

const askNewAddress: AskFn = async state => ({
  state: { ...state, step: 'askNewAddress' },
  replies: [text(msg.askNewAddress)],
});

function askField(state: OrderState, field: AddressField): StepResult {
  return {
    state: { ...state, step: 'askAddressField', missingField: field },
    replies: [text(FIELD_QUESTIONS[field])],
  };
}

const askAddressField: AskFn = async state => {
  const field = state.missingField ?? missingFieldOf(state.draftAddress ?? {}) ?? 'number';
  return askField(state, field);
};

const confirmAddress: AskFn = async state => {
  const { missingField: _missing, ...rest } = state;
  return {
    state: { ...rest, step: 'confirmAddress' },
    replies: [
      buttons(msg.confirmAddress(state.draftAddress as Address), [
        { id: 'address:ok', title: msg.addressOk },
        { id: 'address:retype', title: msg.addressRetype },
      ]),
    ],
  };
};

async function continueDraft(
  state: OrderState,
  draft: AddressDraft,
  tools: FlowTools,
): Promise<StepResult> {
  const next = { ...state, draftAddress: draft };
  const field = missingFieldOf(draft);
  return field ? askField(next, field) : confirmAddress(next, tools);
}

const handleChooseAddress: HandleFn = async (state, input, tools) => {
  const choice = choiceOf(input, 'address');
  if (choice === 'new') return askNewAddress(state, tools);
  if (choice !== null && /^\d+$/.test(choice)) {
    const address = state.addresses?.[Number(choice)];
    if (address) return nextStep({ ...state, address }, tools);
  }
  return chooseAddress(state, tools);
};

const handleAskNewAddress: HandleFn = async (state, input, tools) => {
  const raw = textOf(input);
  if (raw === null) return askNewAddress(state, tools);

  if (CEP_PATTERN.test(raw)) {
    const fromCep = await tools.addressFromCep(raw.replace(/\D/g, ''));
    if (!fromCep) return { state, replies: [text(msg.cepNotFound)] };
    return continueDraft(state, fromCep, tools);
  }

  const fromText = await tools.addressFromText(raw);
  if (!fromText) return { state, replies: [text(msg.didNotUnderstandAddress)] };
  return continueDraft(state, fromText, tools);
};

function applyField(draft: AddressDraft, field: AddressField, raw: string): AddressDraft | null {
  const value = raw.trim();
  if (!value) return null;
  if (field !== 'number') return { ...draft, [field]: value };
  if (NO_NUMBER_PATTERN.test(value)) return { ...draft, number: 'S/N' };
  const match = NUMBER_PATTERN.exec(value);
  if (!match) return null;
  const complement = match[2].trim();
  return { ...draft, number: match[1], ...(complement ? { complement } : {}) };
}

const handleAskAddressField: HandleFn = async (state, input, tools) => {
  const draft = state.draftAddress ?? {};
  const field = state.missingField ?? missingFieldOf(draft);
  if (!field) return confirmAddress(state, tools);
  const raw = textOf(input);
  const updated = raw === null ? null : applyField(draft, field, raw);
  if (!updated) return askField(state, field);
  return continueDraft(state, updated, tools);
};

const handleConfirmAddress: HandleFn = async (state, input, tools) => {
  const choice = choiceOf(input, 'address');
  if (choice === 'retype') return askNewAddress(withoutDraft(state), tools);
  if (choice !== 'ok' || !state.draftAddress) return confirmAddress(state, tools);

  const address = state.draftAddress as Address;
  let customer = state.customer;
  if (customer.id === undefined) {
    try {
      const created = await tools.createCustomer({
        phone: input.phone,
        name: customer.name ?? '',
        cpf: customer.cpf ?? '',
        address,
      });
      customer = { ...customer, id: created.id, tagId: created.tagId };
    } catch (error) {
      if (error instanceof CpfTakenError) {
        return { state: null, replies: [text(msg.cpfTaken(tools.storePhone))] };
      }
      if (error instanceof CustomerRejectedError) {
        return {
          state: { ...withoutDraft(state), step: 'askName', customer: {} },
          replies: [text(msg.registerFailed)],
        };
      }
      throw error;
    }
  }

  return nextStep({ ...withoutDraft(state), customer, address }, tools);
};

export const asks: Partial<Record<Step, AskFn>> = {
  chooseAddress,
  askNewAddress,
  askAddressField,
  confirmAddress,
};

export const handlers: Partial<Record<Step, HandleFn>> = {
  chooseAddress: handleChooseAddress,
  askNewAddress: handleAskNewAddress,
  askAddressField: handleAskAddressField,
  confirmAddress: handleConfirmAddress,
};
