import { describe, expect, it, vi } from 'vitest';
import { runFlow } from './flow';
import type { OrderState } from './flow.types';
import { msg } from './messages';
import { isOrderStatusQuestion } from './order-status';
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
    const tools = createFakeTools({ isVerified: async () => false, latestOrderStatus });
    const gate = await runFlow(null, input('cadê meu gás'), tools);
    expect(gate.state?.step).toBe('askCpfPrefix');
    expect(bodies(gate)).toContain(msg.askCpfPrefix);
    expect(latestOrderStatus).not.toHaveBeenCalled();
    const wrong = await runFlow(gate.state, input('456'), tools);
    expect(latestOrderStatus).not.toHaveBeenCalled();
    expect(bodies(wrong)).toContain(msg.cpfPrefixMismatch);
    const answered = await runFlow(gate.state, input('123'), tools);
    expect(answered.state).toBeNull();
    expect(bodies(answered)).toContain('Pedido nº 8: recebido');
    expect(tools.calls.some(call => call.name === 'markVerified')).toBe(true);
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
    expect(bodies(result)).toContain('2026-10-21 10:00:00');
    expect(bodies(result).includes('handoff:request')).toBe(status === 'WARNING');
    expect(tools.calls.some(call => call.name === 'requestHandoff')).toBe(false);
  });

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
      isVerified: async () => false,
      latestOrderStatus: async () => ({ saleId: 8, status: 'OPEN' }),
    });
    const gate = await runFlow(state, input('status do pedido'), tools);
    const result = await runFlow(gate.state, input('123'), tools);
    expect(result.state).toEqual(state);
    expect(bodies(result)).toContain('Pedido nº 8');
    expect(bodies(result)).toContain('qty:');
  });

  it('consulta pendente retoma a etapa se a verificação já está válida', async () => {
    const gate = await runFlow(
      state,
      input('status do pedido'),
      createFakeTools({ isVerified: async () => false }),
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
      isVerified: async () => false,
      interpret: async () => ({ intent: 'order_status', confidence: 1 }),
      latestOrderStatus,
    });
    const result = await runFlow(state, input('pode consultar o que comprei ontem?'), tools);
    expect(result.state?.step).toBe('askCpfPrefix');
    expect(latestOrderStatus).not.toHaveBeenCalled();
  });

  it.each([{ cpf: undefined }, { blocked: true }])(
    'não revela venda sem CPF ou com bloqueio: %o',
    async condition => {
      const latestOrderStatus = vi.fn();
      const tools = createFakeTools({
        findCustomer: async () => ({
          id: 1,
          name: 'Maria',
          cpf: 'blocked' in condition ? '12345678909' : undefined,
          tagId: null,
        }),
        isBlocked: async () => 'blocked' in condition,
        latestOrderStatus,
      });
      const result = await runFlow(null, input('status do pedido'), tools);
      expect(bodies(result)).toContain(msg.identityContactStore(tools.storePhone));
      expect(latestOrderStatus).not.toHaveBeenCalled();
    },
  );
});
