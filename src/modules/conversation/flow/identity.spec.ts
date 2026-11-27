import { describe, expect, it } from 'vitest';
import type { FlowInput, OrderState } from './flow.types';
import { checkCpf, resolveIdentity } from './identity';
import { handlers, start } from './steps/customer.step';
import { createFakeTools, FAKE_PHONE } from './testing/fake-tools';
import './steps/index';

const say = (body: string): FlowInput => ({
  phone: FAKE_PHONE,
  content: { type: 'text', text: body },
});

const maria = { id: 1, name: 'Maria da Silva', cpf: '12345678909', tagId: null };
const joao = { id: 2, name: 'João Souza', cpf: '98765432100', tagId: 4 };

describe('resolveIdentity', () => {
  it('telefone sem cadastro é cliente novo', async () => {
    const tools = createFakeTools({ findCustomers: async () => [] });
    await expect(resolveIdentity(FAKE_PHONE, tools)).resolves.toEqual({ kind: 'new' });
  });

  it('vínculo válido libera o cliente sem pedir CPF', async () => {
    const tools = createFakeTools({
      findCustomers: async () => [maria, joao],
      verifiedCustomer: async () => 2,
    });
    await expect(resolveIdentity(FAKE_PHONE, tools)).resolves.toEqual({
      kind: 'verified',
      customer: { id: 2, name: 'João Souza', tagId: 4 },
    });
  });

  it('vínculo com cliente que saiu do telefone não conta como verificado', async () => {
    const tools = createFakeTools({
      findCustomers: async () => [maria],
      verifiedCustomer: async () => 99,
    });
    await expect(resolveIdentity(FAKE_PHONE, tools)).resolves.toEqual({ kind: 'ask' });
  });

  it('telefone bloqueado vai para handoff mesmo com vínculo', async () => {
    const tools = createFakeTools({ isBlocked: async () => true });
    await expect(resolveIdentity(FAKE_PHONE, tools)).resolves.toEqual({ kind: 'handoff' });
  });

  it('nenhum cadastro com CPF vai para handoff', async () => {
    const tools = createFakeTools({
      findCustomers: async () => [{ ...maria, cpf: null }],
      verifiedCustomer: async () => null,
    });
    await expect(resolveIdentity(FAKE_PHONE, tools)).resolves.toEqual({ kind: 'handoff' });
  });
});

describe('checkCpf', () => {
  const unverified = { verifiedCustomer: async () => null };

  it('formato inválido não conta tentativa', async () => {
    const tools = createFakeTools(unverified);
    await expect(checkCpf(FAKE_PHONE, '111.222.333-44', tools)).resolves.toEqual({
      kind: 'invalid',
    });
    expect(tools.calls.map(call => call.name)).not.toContain('registerCpfMismatch');
  });

  it('CPF que confere grava o vínculo e emite verified', async () => {
    const tools = createFakeTools({ ...unverified, findCustomers: async () => [maria, joao] });
    await expect(checkCpf(FAKE_PHONE, '987.654.321-00', tools)).resolves.toEqual({
      kind: 'verified',
      customer: { id: 2, name: 'João Souza', tagId: 4 },
    });
    const names = tools.calls.map(call => call.name);
    expect(names).toContain('markVerified');
    expect(tools.calls.find(call => call.name === 'markVerified')?.args).toEqual([FAKE_PHONE, 2]);
    expect(tools.calls.filter(call => call.name === 'track').map(call => call.args[0])).toEqual([
      { name: 'identity_check', outcome: 'verified' },
    ]);
  });

  it('CPF que não confere conta tentativa e emite failed', async () => {
    const tools = createFakeTools(unverified);
    await expect(checkCpf(FAKE_PHONE, '98765432100', tools)).resolves.toEqual({
      kind: 'mismatch',
    });
    expect(tools.calls.map(call => call.name)).toContain('registerCpfMismatch');
    expect(tools.calls.filter(call => call.name === 'track').map(call => call.args[0])).toEqual([
      { name: 'identity_check', outcome: 'failed' },
    ]);
  });

  it('terceiro erro devolve handoff', async () => {
    const tools = createFakeTools({ ...unverified, registerCpfMismatch: async () => 3 });
    await expect(checkCpf(FAKE_PHONE, '98765432100', tools)).resolves.toEqual({
      kind: 'handoff',
    });
  });

  it('CPF que confere com dois cadastros devolve handoff sem vincular', async () => {
    const tools = createFakeTools({
      ...unverified,
      findCustomers: async () => [maria, { ...joao, cpf: maria.cpf }],
    });
    await expect(checkCpf(FAKE_PHONE, maria.cpf, tools)).resolves.toEqual({ kind: 'handoff' });
    expect(tools.calls.map(call => call.name)).not.toContain('markVerified');
  });

  it('telefone bloqueado devolve handoff sem comparar', async () => {
    const tools = createFakeTools({ ...unverified, isBlocked: async () => true });
    await expect(checkCpf(FAKE_PHONE, maria.cpf, tools)).resolves.toEqual({ kind: 'handoff' });
    expect(tools.calls.map(call => call.name)).not.toContain('markVerified');
  });
});

describe('estado da identificação', () => {
  it('o estado nunca guarda CPF nem prefixo do cliente existente', async () => {
    const tools = createFakeTools({ verifiedCustomer: async () => null });
    const asked = await start(say('oi'), tools);
    const state: OrderState = { step: 'confirmCpf', customer: {} };
    expect(asked.state).toEqual(state);
    const wrong = await handlers.confirmCpf?.(state, say('98765432100'), tools);
    const right = await handlers.confirmCpf?.(state, say('123.456.789-09'), tools);
    for (const state of [asked.state, wrong?.state, right?.state]) {
      const stored = JSON.stringify(state);
      expect(stored).not.toContain('12345678909');
      expect(stored).not.toContain('cpfPrefix');
      expect(stored).not.toContain('"cpf"');
    }
  });
});
