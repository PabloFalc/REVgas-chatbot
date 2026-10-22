import {
  CpfTakenError,
  CustomerRejectedError,
} from 'src/modules/customer/contracts/customer.types';
import { describe, expect, it } from 'vitest';
import { type FlowInput, type OrderState, ToolError } from '../flow.types';
import { msg } from '../messages';
import { buttons, text } from '../replies';
import { createFakeTools, FAKE_PHONE } from '../testing/fake-tools';
import { asks, handlers } from './address.step';
import { asks as registry } from './registry';

const say = (body: string): FlowInput => ({
  phone: FAKE_PHONE,
  content: { type: 'text', text: body },
});
const pick = (id: string): FlowInput => ({
  phone: FAKE_PHONE,
  content: { type: 'choice', id, title: id },
});

const a1 = {
  street: 'Rua das Flores',
  number: '120',
  neighborhood: 'Centro',
  city: 'Teresina',
  state: 'PI',
};
const a2 = { ...a1, street: 'Av. Frei Serafim', number: '900' };
const a3 = { ...a1, street: 'Rua Nova', number: '5' };

const known: OrderState = {
  step: 'chooseAddress',
  customer: { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: null },
  addresses: [a1, a2],
};

describe('chooseAddress', () => {
  it('até 2 endereços vira botões com endereços numerados no corpo', async () => {
    const result = await asks.chooseAddress?.(known, createFakeTools());
    const reply = result?.replies[0];
    expect(reply?.type).toBe('buttons');
    if (reply?.type !== 'buttons') return;
    expect(reply.buttons.map(b => b.id)).toEqual(['address:0', 'address:1', 'address:new']);
    expect(reply.body).toContain(`1. ${msg.addressFull(a1)}`);
    expect(reply.body).toContain(`2. ${msg.addressFull(a2)}`);
    expect(reply.buttons.every(b => b.title.length <= 20)).toBe(true);
  });

  it('mais de 2 endereços vira lista com até 9 mais outro', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...a1, number: String(i) }));
    const result = await asks.chooseAddress?.({ ...known, addresses: many }, createFakeTools());
    const reply = result?.replies[0];
    expect(reply?.type).toBe('list');
    if (reply?.type !== 'list') return;
    const ids = reply.sections[0].rows.map(r => r.id);
    expect(ids).toHaveLength(10);
    expect(ids[8]).toBe('address:8');
    expect(ids[9]).toBe('address:new');
  });

  it('3 endereços já usam lista', async () => {
    const result = await asks.chooseAddress?.(
      { ...known, addresses: [a1, a2, a3] },
      createFakeTools(),
    );
    expect(result?.replies[0].type).toBe('list');
  });

  it('escolher um endereço guarda e segue o fluxo', async () => {
    const result = await handlers.chooseAddress?.(known, pick('address:1'), createFakeTools());
    expect(result?.state?.address).toEqual(a2);
    expect(result?.state?.step).toBe('chooseProduct');
  });

  it('índice inexistente repete a pergunta', async () => {
    const result = await handlers.chooseAddress?.(known, pick('address:7'), createFakeTools());
    expect(result?.state?.step).toBe('chooseAddress');
    expect(result?.state?.address).toBeUndefined();
    expect(result?.replies[0].type).toBe('buttons');
  });

  it('address:new vai pedir o endereço', async () => {
    const result = await handlers.chooseAddress?.(known, pick('address:new'), createFakeTools());
    expect(result?.state?.step).toBe('askNewAddress');
    expect(result?.replies).toEqual([text(msg.askNewAddress)]);
  });
});

describe('askNewAddress', () => {
  const state: OrderState = { ...known, step: 'askNewAddress' };

  it('CEP com traço consulta só com dígitos e pede o número', async () => {
    const tools = createFakeTools();
    const result = await handlers.askNewAddress?.(state, say('64000-123'), tools);
    expect(tools.calls).toEqual([{ name: 'addressFromCep', args: ['64000123'] }]);
    expect(result?.state?.step).toBe('askAddressField');
    expect(result?.state?.missingField).toBe('number');
    expect(result?.replies).toEqual([text(msg.askNumber)]);
  });

  it('CEP não encontrado avisa e continua', async () => {
    const tools = createFakeTools({ addressFromCep: async () => null });
    const result = await handlers.askNewAddress?.(state, say('64000123'), tools);
    expect(result?.state?.step).toBe('askNewAddress');
    expect(result?.replies).toEqual([text(msg.cepNotFound)]);
  });

  it('texto livre completo vai para a confirmação', async () => {
    const tools = createFakeTools();
    const result = await handlers.askNewAddress?.(state, say('Rua das Flores 120 Centro'), tools);
    expect(tools.calls[0].name).toBe('addressFromText');
    expect(result?.state?.step).toBe('confirmAddress');
    expect(result?.state?.draftAddress).toEqual(a1);
    expect(result?.replies[0]).toEqual(
      buttons(msg.confirmAddress(a1), [
        { id: 'address:ok', title: msg.addressOk },
        { id: 'address:retype', title: msg.addressRetype },
      ]),
    );
  });

  it('texto livre incompleto pede o campo que falta', async () => {
    const tools = createFakeTools({
      addressFromText: async () => ({ ...a1, neighborhood: undefined }),
    });
    const result = await handlers.askNewAddress?.(state, say('Rua das Flores 120'), tools);
    expect(result?.state?.missingField).toBe('neighborhood');
    expect(result?.replies).toEqual([text(msg.askNeighborhood)]);
  });

  it('IA devolvendo null pede o CEP', async () => {
    const tools = createFakeTools({ addressFromText: async () => null });
    const result = await handlers.askNewAddress?.(state, say('sei lá'), tools);
    expect(result?.state?.step).toBe('askNewAddress');
    expect(result?.replies).toEqual([text(msg.didNotUnderstandAddress)]);
  });
});

describe('askNewAddress com texto pendente', () => {
  it('askNewAddress com texto pendente que a IA não entende', async () => {
    const tools = createFakeTools({ addressFromText: async () => null });
    const result = await asks.askNewAddress?.(
      { ...known, step: 'askNewAddress', pendingAddressText: 'blablabla' },
      tools,
    );
    expect(result?.replies).toEqual([text(msg.didNotUnderstandAddress)]);
    expect(result?.state?.step).toBe('askNewAddress');
    expect(result?.state?.pendingAddressText).toBeUndefined();
  });
});

describe('askAddressField', () => {
  const base: OrderState = {
    ...known,
    step: 'askAddressField',
    missingField: 'number',
    draftAddress: { ...a1, number: undefined },
  };

  it('número com complemento separa o complemento', async () => {
    const result = await handlers.askAddressField?.(base, say('120 apto 3'), createFakeTools());
    expect(result?.state?.draftAddress).toMatchObject({ number: '120', complement: 'apto 3' });
    expect(result?.state?.step).toBe('confirmAddress');
  });

  it('s/n vira S/N', async () => {
    const result = await handlers.askAddressField?.(base, say('s/n'), createFakeTools());
    expect(result?.state?.draftAddress?.number).toBe('S/N');
  });

  it('número inválido repete a pergunta', async () => {
    const result = await handlers.askAddressField?.(base, say('perto da praça'), createFakeTools());
    expect(result?.state?.step).toBe('askAddressField');
    expect(result?.replies).toEqual([text(msg.askNumber)]);
  });

  it('campo de texto aceita texto e segue para o próximo faltante', async () => {
    const state: OrderState = {
      ...base,
      missingField: 'street',
      draftAddress: { number: '10', city: 'Teresina', state: 'PI' },
    };
    const result = await handlers.askAddressField?.(state, say('Rua Nova'), createFakeTools());
    expect(result?.state?.draftAddress?.street).toBe('Rua Nova');
    expect(result?.state?.missingField).toBe('neighborhood');
  });
});

describe('confirmAddress', () => {
  const newCustomer: OrderState = {
    step: 'confirmAddress',
    customer: { name: 'Joana Lima', cpf: '12345678909' },
    draftAddress: a1,
  };

  it('retype limpa o rascunho e pede o endereço', async () => {
    const result = await handlers.confirmAddress?.(
      newCustomer,
      pick('address:retype'),
      createFakeTools(),
    );
    expect(result?.state?.step).toBe('askNewAddress');
    expect(result?.state?.draftAddress).toBeUndefined();
  });

  it('ok de cliente novo cria o cadastro e segue o fluxo', async () => {
    const tools = createFakeTools();
    const result = await handlers.confirmAddress?.(newCustomer, pick('address:ok'), tools);
    expect(tools.calls).toEqual([
      {
        name: 'createCustomer',
        args: [{ phone: FAKE_PHONE, name: 'Joana Lima', cpf: '12345678909', address: a1 }],
      },
    ]);
    expect(result?.state?.customer).toMatchObject({ id: 2, tagId: null });
    expect(result?.state?.address).toEqual(a1);
    expect(result?.state?.draftAddress).toBeUndefined();
    expect(result?.state?.step).toBe('chooseProduct');
  });

  it('falha logo após criar o cadastro guarda o cliente criado e avisa indisponível', async () => {
    const tools = createFakeTools();
    const original = registry.chooseProduct;
    registry.chooseProduct = async () => {
      throw new ToolError(new Error('fora'));
    };
    let result: Awaited<ReturnType<NonNullable<typeof handlers.confirmAddress>>> | undefined;
    try {
      result = await handlers.confirmAddress?.(newCustomer, pick('address:ok'), tools);
    } finally {
      registry.chooseProduct = original;
    }
    expect(result?.replies).toEqual([text(msg.unavailable)]);
    expect(result?.state).toMatchObject({
      step: 'chooseProduct',
      customer: { id: 2, tagId: null },
      address: a1,
    });
    expect(result?.state?.draftAddress).toBeUndefined();
  });

  it('ok de cliente conhecido não cria cadastro', async () => {
    const tools = createFakeTools();
    const state: OrderState = { ...known, step: 'confirmAddress', draftAddress: a3 };
    const result = await handlers.confirmAddress?.(state, pick('address:ok'), tools);
    expect(tools.calls).toEqual([]);
    expect(result?.state?.address).toEqual(a3);
  });

  it('CPF já cadastrado encerra a conversa', async () => {
    const tools = createFakeTools({
      createCustomer: async () => {
        throw new ToolError(new CpfTakenError());
      },
    });
    const result = await handlers.confirmAddress?.(newCustomer, pick('address:ok'), tools);
    expect(result).toEqual({ state: null, replies: [text(msg.cpfTaken(tools.storePhone))] });
  });

  it('CPF já cadastrado também é reconhecido sem o ToolError', async () => {
    const tools = createFakeTools({
      createCustomer: async () => {
        throw new CpfTakenError();
      },
    });
    const result = await handlers.confirmAddress?.(newCustomer, pick('address:ok'), tools);
    expect(result?.state).toBeNull();
  });

  it('erro de ferramenta desconhecido é relançado', async () => {
    const tools = createFakeTools({
      createCustomer: async () => {
        throw new ToolError(new Error('fora'));
      },
    });
    await expect(
      handlers.confirmAddress?.(newCustomer, pick('address:ok'), tools),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it('cadastro recusado volta para o nome', async () => {
    const tools = createFakeTools({
      createCustomer: async () => {
        throw new ToolError(new CustomerRejectedError());
      },
    });
    const result = await handlers.confirmAddress?.(newCustomer, pick('address:ok'), tools);
    expect(result?.state?.step).toBe('askName');
    expect(result?.state?.customer).toEqual({});
    expect(result?.replies).toEqual([text(msg.registerFailed)]);
  });
});
