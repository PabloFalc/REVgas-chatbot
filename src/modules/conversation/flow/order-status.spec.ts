import { describe, expect, it, vi } from 'vitest';
import { runFlow } from './flow';
import type { OrderState } from './flow.types';
import { msg } from './messages';
import { isOrderStatusQuestion } from './order-status';
import { text } from './replies';
import { createFakeTools, FAKE_PHONE } from './testing/fake-tools';

const input = (body: string, phone = FAKE_PHONE) => ({
  phone,
  content: { type: 'text' as const, text: body },
});
const bodies = (result: { replies: unknown[] }) => JSON.stringify(result.replies);
const state: OrderState = {
  step: 'chooseQuantity',
  customer: { id: 1 },
  product: { id: 1, name: 'Botijão P13' },
  quantity: 2,
};

describe('status do pedido', () => {
  it.each([
    'meu pedido chegou?',
    'cadê meu gás',
    'status do pedido',
    'já saiu pra entrega?',
    'onde está meu botijão?',
  ])('reconhece %s', raw => {
    expect(isOrderStatusQuestion(raw)).toBe(true);
  });

  it.each([
    'quero um gás',
    'quero fazer um pedido',
    'vocês entregam?',
    'meu gás acabou',
    'qual o preço do gás?',
    'quero gás para entrega',
  ])('não reconhece %s', raw => {
    expect(isOrderStatusQuestion(raw)).toBe(false);
  });

  it('verifica o CPF antes de consultar e responde logo após o acerto', async () => {
    const latestOrderStatus = vi.fn(async () => ({ saleId: 8, status: 'OPEN' }));
    const tools = createFakeTools({ verifiedCustomer: async () => null, latestOrderStatus });
    const gate = await runFlow(null, input('cadê meu gás'), tools);
    expect(gate.state?.step).toBe('confirmCpf');
    expect(bodies(gate)).toContain(msg.askFullCpf);
    expect(latestOrderStatus).not.toHaveBeenCalled();
    const wrong = await runFlow(gate.state, input('98765432100'), tools);
    expect(latestOrderStatus).not.toHaveBeenCalled();
    expect(bodies(wrong)).toContain(msg.cpfMismatch);
    const answered = await runFlow(gate.state, input('123.456.789-09'), tools);
    expect(answered.state).toBeNull();
    expect(bodies(answered)).toContain('Pedido nº 8: recebido');
    expect(tools.calls.some(call => call.name === 'markVerified')).toBe(true);
  });

  it('só libera histórico após CPF completo corresponder a um dos cadastros do telefone', async () => {
    const latestOrderStatus = vi.fn(async () => ({ saleId: 8, status: 'OPEN' }));
    const tools = createFakeTools({
      verifiedCustomer: async () => null,
      findCustomers: async () => [
        { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: null },
        { id: 2, name: 'João Souza', cpf: '98765432100', tagId: null },
      ],
      latestOrderStatus,
    });
    const gate = await runFlow(null, input('status do pedido'), tools);
    const outsider = await runFlow(gate.state, input('529.982.247-25'), tools);
    expect(latestOrderStatus).not.toHaveBeenCalled();
    expect(bodies(outsider)).not.toContain('Pedido');
    const owner = await runFlow(gate.state, input('987.654.321-00'), tools);
    expect(latestOrderStatus).toHaveBeenCalledOnce();
    expect(latestOrderStatus).toHaveBeenCalledWith(2, expect.any(Date));
    expect(bodies(owner)).toContain('Pedido nº 8');
    expect(tools.calls.some(call => call.name === 'customerHistory')).toBe(false);
  });

  it('telefone desconhecido recebe texto fixo e botão sem consultar vendas', async () => {
    const latestOrderStatus = vi.fn();
    const tools = createFakeTools({ phone: '5586000000000', latestOrderStatus });
    const result = await runFlow(null, input('status do pedido', tools.phone), tools);
    expect(result.state).toBeNull();
    expect(bodies(result)).toContain('Não encontrei pedido para este número');
    expect(bodies(result)).toContain('order:start');
    expect(latestOrderStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['OPEN', 'recebido'],
    ['ACTIVE', 'em andamento'],
    ['CONFIRM', 'confirmado'],
    ['CHECK', 'em conferência'],
    ['NEW_STATUS', 'em andamento'],
    ['constructor', 'em andamento'],
    ['WARNING', 'com pendência, um atendente vai verificar'],
    ['WARN', 'com pendência, um atendente vai verificar'],
  ])('traduz %s', async (status, label) => {
    const tools = createFakeTools({
      latestOrderStatus: async () => ({
        saleId: 8,
        status,
        delivererName: 'José',
        deliveredAt: '2026-10-21 10:00:00',
      }),
    });
    const result = await runFlow(null, input('status do pedido'), tools);
    expect(bodies(result)).toContain(`Pedido nº 8: ${label}`);
    expect(bodies(result)).toContain('José');
    expect(bodies(result)).toContain('21/10 às 10:00');
    expect(bodies(result).includes('handoff:request')).toBe(
      status === 'WARNING' || status === 'WARN',
    );
    expect(tools.calls.some(call => call.name === 'requestHandoff')).toBe(false);
  });

  it.each([
    [false, 'Pedido nº 8: recebido.'],
    [true, 'Pedido de demonstração.\nPedido nº 8: recebido.'],
  ])('demonstração %s ajusta a resposta do status', async (demo, expected) => {
    const tools = createFakeTools({
      demo,
      latestOrderStatus: async () => ({ saleId: 8, status: 'OPEN' }),
    });
    const result = await runFlow(null, input('status do pedido'), tools);
    expect(result.replies).toEqual([text(expected)]);
  });

  it.each([
    ['2026-10-21 10:00:00', '21/10 às 10:00'],
    ['2026-10-21T10:00:00', '21/10 às 10:00'],
    ['2026-10-21T13:00:00Z', '21/10 às 10:00'],
    ['2026-10-21T10:00:00-03:00', '21/10 às 10:00'],
    ['2026-10-21T01:00:00+02:00', '20/10 às 20:00'],
  ])('formata entrega %s no fuso de São Paulo', async (deliveredAt, formatted) => {
    const tools = createFakeTools({
      latestOrderStatus: async () => ({ saleId: 8, status: 'CONFIRM', deliveredAt }),
    });
    const result = await runFlow(null, input('status do pedido'), tools);
    expect(bodies(result)).toContain(`Entrega registrada em: ${formatted}.`);
    expect(bodies(result)).not.toContain(deliveredAt);
  });

  it.each(['inválida', '2026-13-40T25:70:00', '', null, undefined])(
    'omite data de entrega inválida ou ausente: %s',
    async deliveredAt => {
      const tools = createFakeTools({
        latestOrderStatus: async () => ({ saleId: 8, status: 'CONFIRM', deliveredAt }),
      });
      const result = await runFlow(null, input('status do pedido'), tools);
      expect(bodies(result)).toContain('Pedido nº 8: confirmado');
      expect(bodies(result)).not.toContain('Entrega registrada');
      expect(bodies(result)).not.toContain('Invalid Date');
    },
  );

  it.each([true, false])(
    'aceita o produto novo da lista repetida com cliente encontrado: %s',
    async knownCustomer => {
      const originalProducts = [{ id: 1, name: 'Botijão P13' }];
      const newProducts = [{ id: 4, name: 'Botijão P20' }];
      const listProducts = vi
        .fn()
        .mockResolvedValueOnce(originalProducts)
        .mockResolvedValue(newProducts);
      const tools = createFakeTools({ listProducts });
      const original = await runFlow(
        { step: 'chooseProduct', customer: { id: 1 } },
        { phone: FAKE_PHONE, content: { type: 'choice', id: 'product:99' } },
        tools,
      );
      expect(original.state?.productOptions).toEqual(originalProducts);
      if (!knownCustomer) tools.findCustomers = async () => [];

      const repeated = await runFlow(original.state, input('status do pedido'), tools);
      expect(repeated.state?.productOptions).toEqual(newProducts);
      expect(bodies(repeated)).toContain('product:4');

      const selected = await runFlow(
        repeated.state,
        { phone: FAKE_PHONE, content: { type: 'choice', id: 'product:4' } },
        tools,
      );
      expect(selected.state?.product).toEqual(newProducts[0]);
      expect(selected.state?.step).toBe('askNewAddress');
    },
  );

  it('preserva o pedido e repete a pergunta', async () => {
    const tools = createFakeTools({
      latestOrderStatus: async () => ({ saleId: 8, status: 'OPEN' }),
    });
    const result = await runFlow(state, input('status do pedido'), tools);
    expect(result.state).toEqual(state);
    expect(result.replies).toHaveLength(2);
    expect(bodies(result)).toContain('qty:');
    expect(tools.calls.some(call => call.name === 'createSale')).toBe(false);
  });

  it('retoma o pedido intacto após renovar a verificação vencida', async () => {
    const tools = createFakeTools({
      verifiedCustomer: async () => null,
      latestOrderStatus: async () => ({ saleId: 8, status: 'OPEN' }),
    });
    const gate = await runFlow(state, input('status do pedido'), tools);
    const result = await runFlow(gate.state, input('123.456.789-09'), tools);
    expect(result.state).toEqual(state);
    expect(bodies(result)).toContain('Pedido nº 8');
    expect(bodies(result)).toContain('qty:');
  });

  it('consulta pendente retoma a etapa se a verificação já está válida', async () => {
    const gate = await runFlow(
      state,
      input('status do pedido'),
      createFakeTools({ verifiedCustomer: async () => null }),
    );
    const result = await runFlow(
      gate.state,
      input('status do pedido'),
      createFakeTools({
        latestOrderStatus: async () => ({ saleId: 8, status: 'OPEN' }),
      }),
    );
    expect(result.state).toEqual(state);
    expect(bodies(result)).toContain('Pedido nº 8');
    expect(bodies(result)).toContain('qty:');
  });

  it('sem venda e sem pedido não cria estado', async () => {
    const result = await runFlow(null, input('status do pedido'), createFakeTools());
    expect(result.state).toBeNull();
    expect(bodies(result)).toContain('order:start');
  });

  it('sem venda oferece fazer pedido e mantém o pedido atual', async () => {
    const result = await runFlow(state, input('status do pedido'), createFakeTools());
    expect(result.state).toEqual(state);
    expect(bodies(result)).toContain('Não encontrei pedido recente');
    expect(bodies(result)).toContain('order:start');
  });

  it('falha na RevGás usa mensagem de indisponibilidade e mantém o pedido', async () => {
    const tools = createFakeTools({
      latestOrderStatus: async () => {
        throw new Error('RevGás indisponível');
      },
    });
    const result = await runFlow(state, input('status do pedido'), tools);
    expect(result.state).toEqual(state);
    expect(bodies(result)).toContain(msg.unavailable);
  });

  it('encaminha intenção da IA pelo mesmo gate', async () => {
    const latestOrderStatus = vi.fn();
    const tools = createFakeTools({
      verifiedCustomer: async () => null,
      interpret: async () => ({ intent: 'order_status', confidence: 1 }),
      latestOrderStatus,
    });
    const result = await runFlow(state, input('pode consultar o que comprei ontem?'), tools);
    expect(result.state?.step).toBe('confirmCpf');
    expect(latestOrderStatus).not.toHaveBeenCalled();
  });

  it.each([{ cpf: undefined }, { blocked: true }])(
    'não revela venda sem CPF ou com bloqueio: %o',
    async condition => {
      const latestOrderStatus = vi.fn();
      const tools = createFakeTools({
        findCustomers: async () => [
          {
            id: 1,
            name: 'Maria',
            cpf: 'blocked' in condition ? '12345678909' : null,
            tagId: null,
          },
        ],
        verifiedCustomer: async () => null,
        isBlocked: async () => 'blocked' in condition,
        latestOrderStatus,
      });
      const result = await runFlow(null, input('status do pedido'), tools);
      expect(bodies(result)).toContain(msg.identityContactStore(tools.storePhone));
      expect(latestOrderStatus).not.toHaveBeenCalled();
    },
  );
});
