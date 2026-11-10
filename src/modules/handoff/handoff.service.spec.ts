import type { PinoLogger } from 'nestjs-pino';
import { FakeChatwootClient } from 'src/integrations/chatwoot/fake-chatwoot.client';
import { parseServiceHours, type ServiceWindow } from 'src/utils/service-hours';
import { describe, expect, it, vi } from 'vitest';
import type { DeskContact, DeskThread, HandoffState } from './contracts/handoff.types';
import { EXPIRED_NOTE } from './contracts/handoff-note';
import { DeskGateway } from './desk.gateway';
import type { HandoffRepository } from './handoff.repository';
import { HandoffService, type TurnRecord } from './handoff.service';

const PHONE = '5585999990000';
const NOW = new Date('2026-11-09T10:00:00-03:00');
const CPF_DIGITS = /\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2}/;

function memoryRepository() {
  const states = new Map<string, HandoffState>();
  const threads = new Map<string, DeskThread>();
  const contacts = new Map<string, DeskContact>();
  const claimed = new Set<number>();
  const repo = {
    getState: async (phone: string) => states.get(phone) ?? null,
    saveState: async (phone: string, state: HandoffState) => {
      states.set(phone, state);
    },
    clearState: async (phone: string) => {
      states.delete(phone);
    },
    getThread: async (phone: string) => threads.get(phone) ?? null,
    saveThread: async (phone: string, thread: DeskThread) => {
      threads.set(phone, thread);
    },
    clearThread: async (phone: string) => {
      threads.delete(phone);
    },
    getContact: async (phone: string) => contacts.get(phone) ?? null,
    saveContact: async (phone: string, contact: DeskContact) => {
      contacts.set(phone, contact);
    },
    claimDeskMessage: async (id: number) => {
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    },
  };
  return { repo: repo as unknown as HandoffRepository, states, threads, contacts };
}

function setup(options: { now?: Date; hours?: ServiceWindow[]; disabled?: boolean } = {}) {
  const client = new FakeChatwootClient({ inboxId: 1 });
  const desk = new DeskGateway(options.disabled ? null : client, {
    mode: options.disabled ? 'off' : 'fake',
    baseUrl: '',
    timeoutMs: 1,
    inboxId: 1,
  });
  const memory = memoryRepository();
  const logger = {
    setContext: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  const clock = { now: () => options.now ?? NOW };
  const service = new HandoffService(
    memory.repo,
    desk,
    logger as unknown as PinoLogger,
    clock,
    options.hours ?? [],
  );
  return { service, client, logger, ...memory };
}

function turn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    phone: PHONE,
    name: 'Maria',
    inbound: { type: 'text', text: 'oi' },
    sensitive: false,
    botMessages: ['Olá!'],
    newCycle: false,
    ended: false,
    ...overrides,
  };
}

function allMessages(client: FakeChatwootClient) {
  return [...client.conversations.values()].flatMap(conversation => conversation.messages);
}

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

describe('HandoffService', () => {
  describe('requestHandoff', () => {
    it('entra na fila com nota, conversa open e estado queued', async () => {
      const { service, client, states } = setup();
      const outcome = await service.requestHandoff({
        phone: PHONE,
        reason: 'customer_request',
        summary: null,
      });
      expect(outcome).toEqual({ status: 'queued', open: true, nextOpening: null });
      const [conversation] = [...client.conversations.values()];
      expect(conversation.status).toBe('open');
      const note = conversation.messages.find(message => message.private);
      expect(note?.content).toContain('Cliente pediu atendente');
      expect(states.get(PHONE)).toEqual({
        status: 'queued',
        conversationId: conversation.id,
        reason: 'customer_request',
        since: NOW.toISOString(),
      });
    });

    it('segunda chamada devolve alreadyQueued sem nota nova', async () => {
      const { service, client } = setup();
      const request = { phone: PHONE, reason: 'customer_request' as const, summary: null };
      await service.requestHandoff(request);
      const before = allMessages(client).length;
      const outcome = await service.requestHandoff(request);
      expect(outcome.status).toBe('alreadyQueued');
      expect(allMessages(client)).toHaveLength(before);
    });

    it('estado active devolve active', async () => {
      const { service, states } = setup();
      states.set(PHONE, {
        status: 'active',
        conversationId: 9,
        reason: 'agent',
        since: minutesAgo(10),
        lastAgentAt: minutesAgo(5),
      });
      const outcome = await service.requestHandoff({
        phone: PHONE,
        reason: 'customer_request',
        summary: null,
      });
      expect(outcome.status).toBe('active');
    });

    it('reaproveita a conversa do ciclo atual', async () => {
      const { service, client, threads } = setup();
      await service.recordTurn(turn());
      const threadId = threads.get(PHONE)?.conversationId;
      await service.requestHandoff({ phone: PHONE, reason: 'sale_failed', summary: null });
      expect(client.conversations.size).toBe(1);
      expect(client.conversations.get(threadId as number)?.status).toBe('open');
    });

    it('fora do horário informa a próxima abertura', async () => {
      const { service } = setup({
        now: new Date('2026-11-08T10:00:00-03:00'),
        hours: parseServiceHours('seg-sex 08:00-18:00'),
      });
      const outcome = await service.requestHandoff({
        phone: PHONE,
        reason: 'customer_request',
        summary: null,
      });
      expect(outcome).toEqual({
        status: 'queued',
        open: false,
        nextOpening: { weekday: 1, time: '08:00', inDays: 1 },
      });
    });

    it('falha do Chatwoot devolve unavailable e não salva estado', async () => {
      const { service, client, states, logger } = setup();
      client.failNext();
      const outcome = await service.requestHandoff({
        phone: PHONE,
        reason: 'customer_request',
        summary: null,
      });
      expect(outcome.status).toBe('unavailable');
      expect(states.size).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'handoff', error: 'unavailable' }),
        expect.any(String),
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(PHONE);
    });

    it('desligado devolve unavailable', async () => {
      const { service, states } = setup({ disabled: true });
      const outcome = await service.requestHandoff({
        phone: PHONE,
        reason: 'customer_request',
        summary: null,
      });
      expect(outcome).toEqual({ status: 'unavailable', open: true, nextOpening: null });
      expect(states.size).toBe(0);
    });
  });

  describe('serviceHours', () => {
    it('sem horário é sempre aberto', () => {
      expect(setup().service.serviceHours()).toEqual({
        open: true,
        nextOpening: null,
        windows: [],
      });
    });

    it('com horário calcula aberto e próxima abertura', () => {
      const hours = parseServiceHours('seg-sex 08:00-18:00');
      const { service } = setup({ now: new Date('2026-11-08T10:00:00-03:00'), hours });
      expect(service.serviceHours()).toEqual({
        open: false,
        nextOpening: { weekday: 1, time: '08:00', inDays: 1 },
        windows: hours,
      });
    });
  });

  describe('recordTurn', () => {
    it('cria conversa pending e espelha entrada e respostas', async () => {
      const { service, client, threads, contacts } = setup();
      await service.recordTurn(turn({ botMessages: ['Olá!', 'Qual produto?'] }));
      const [conversation] = [...client.conversations.values()];
      expect(conversation.status).toBe('pending');
      expect(conversation.messages.map(message => [message.content, message.type])).toEqual([
        ['oi', 'incoming'],
        ['Olá!', 'outgoing'],
        ['Qual produto?', 'outgoing'],
      ]);
      expect(threads.get(PHONE)).toEqual({ conversationId: conversation.id });
      expect(contacts.get(PHONE)).toBeDefined();
    });

    it('reaproveita a thread nos turnos seguintes', async () => {
      const { service, client } = setup();
      await service.recordTurn(turn());
      await service.recordTurn(turn({ inbound: { type: 'choice', title: 'P13' } }));
      expect(client.conversations.size).toBe(1);
      const [conversation] = [...client.conversations.values()];
      expect(conversation.messages.map(message => message.content)).toContain('P13');
    });

    it('etapa sensível posta [CPF ocultado]', async () => {
      const { service, client } = setup();
      await service.recordTurn(
        turn({ inbound: { type: 'text', text: '12345678909' }, sensitive: true }),
      );
      expect(allMessages(client)[0].content).toBe('[CPF ocultado]');
    });

    it('oculta CPF no texto livre e em títulos', async () => {
      const { service, client } = setup();
      await service.recordTurn(
        turn({ inbound: { type: 'text', text: 'meu cpf é 123.456.789-09' } }),
      );
      await service.recordTurn(turn({ inbound: { type: 'choice', title: 'CPF 12345678909' } }));
      expect(allMessages(client)[0].content).toBe('meu cpf é [CPF ocultado]');
      for (const message of allMessages(client)) {
        expect(message.content).not.toMatch(CPF_DIGITS);
      }
    });

    it('falha do Chatwoot não lança', async () => {
      const { service, client, logger } = setup();
      client.failNext();
      await expect(service.recordTurn(turn())).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('desligado não faz nada', async () => {
      const { service, threads } = setup({ disabled: true });
      await expect(service.recordTurn(turn())).resolves.toBeUndefined();
      expect(threads.size).toBe(0);
    });

    it('venda criada na fila resolve a conversa e apaga estado e thread', async () => {
      const { service, client, states, threads } = setup();
      await service.requestHandoff({ phone: PHONE, reason: 'customer_request', summary: null });
      await service.recordTurn(turn({ botMessages: ['Pedido criado'], ended: true, saleId: 4521 }));
      const [conversation] = [...client.conversations.values()];
      const notes = conversation.messages.filter(message => message.private);
      expect(notes.at(-1)?.content).toBe('Venda #4521 criada pelo bot, saiu da fila.');
      expect(conversation.status).toBe('resolved');
      expect(states.size).toBe(0);
      expect(threads.size).toBe(0);
    });

    it('ended sem handoff resolve e esquece a thread', async () => {
      const { service, client, threads } = setup();
      await service.recordTurn(turn({ ended: true }));
      const [conversation] = [...client.conversations.values()];
      expect(conversation.status).toBe('resolved');
      expect(threads.size).toBe(0);
    });

    it('ended com handoff na fila mantém a conversa', async () => {
      const { service, client, states, threads } = setup();
      await service.requestHandoff({ phone: PHONE, reason: 'customer_request', summary: null });
      await service.recordTurn(turn({ ended: true }));
      const [conversation] = [...client.conversations.values()];
      expect(conversation.status).toBe('open');
      expect(states.get(PHONE)?.status).toBe('queued');
      expect(threads.size).toBe(1);
    });

    it('newCycle com thread antiga resolve a antiga e cria outra pending', async () => {
      const { service, client, threads } = setup();
      await service.recordTurn(turn());
      const oldId = threads.get(PHONE)?.conversationId as number;
      await service.recordTurn(turn({ newCycle: true }));
      const newId = threads.get(PHONE)?.conversationId as number;
      expect(newId).not.toBe(oldId);
      expect(client.conversations.get(oldId)?.status).toBe('resolved');
      expect(client.conversations.get(newId)?.status).toBe('pending');
      expect(client.conversations.get(newId)?.messages[0].content).toBe('oi');
    });

    it('newCycle na fila não troca a conversa', async () => {
      const { service, client } = setup();
      await service.requestHandoff({ phone: PHONE, reason: 'customer_request', summary: null });
      await service.recordTurn(turn({ newCycle: true }));
      expect(client.conversations.size).toBe(1);
    });
  });

  describe('markAgentMessage e routeFor', () => {
    it('de queued vira active uma vez e passa a rotear para o atendente', async () => {
      const { service, states } = setup();
      await service.requestHandoff({ phone: PHONE, reason: 'customer_request', summary: null });
      const conversationId = states.get(PHONE)?.conversationId as number;
      expect(await service.routeFor(PHONE)).toBe('bot');
      await expect(service.markAgentMessage(PHONE, conversationId)).resolves.toEqual({
        becameActive: true,
      });
      await expect(service.markAgentMessage(PHONE, conversationId)).resolves.toEqual({
        becameActive: false,
      });
      expect(await service.routeFor(PHONE)).toBe('agent');
      expect(states.get(PHONE)).toEqual({
        status: 'active',
        conversationId,
        reason: 'customer_request',
        since: NOW.toISOString(),
        lastAgentAt: NOW.toISOString(),
      });
    });

    it('sem estado vira active com motivo agent e guarda a thread', async () => {
      const { service, states, threads } = setup();
      await expect(service.markAgentMessage(PHONE, 42)).resolves.toEqual({ becameActive: true });
      expect(states.get(PHONE)?.reason).toBe('agent');
      expect(threads.get(PHONE)).toEqual({ conversationId: 42 });
    });

    it('com o desk desativado não grava nada', async () => {
      const { service, states, threads } = setup({ disabled: true });
      await expect(service.markAgentMessage(PHONE, 42)).resolves.toEqual({ becameActive: false });
      expect(states.size).toBe(0);
      expect(threads.size).toBe(0);
    });

    it('mantém o since de um active anterior', async () => {
      const { service, states } = setup();
      states.set(PHONE, {
        status: 'active',
        conversationId: 7,
        reason: 'agent',
        since: minutesAgo(60),
        lastAgentAt: minutesAgo(30),
      });
      await service.markAgentMessage(PHONE, 7);
      expect(states.get(PHONE)?.since).toBe(minutesAgo(60));
      expect(states.get(PHONE)?.lastAgentAt).toBe(NOW.toISOString());
    });
  });

  describe('expiração', () => {
    async function expiredSetup(state: Omit<HandoffState, 'conversationId'>) {
      const context = setup();
      const id = await context.client
        .createConversation({ contactId: 1, sourceId: 's', status: 'open' })
        .then(result => result.id);
      context.states.set(PHONE, { ...state, conversationId: id });
      context.threads.set(PHONE, { conversationId: id });
      return { ...context, id };
    }

    it('active há 24 h + 1 min volta ao bot, com nota e conversa resolvida', async () => {
      const { service, client, states, threads, id } = await expiredSetup({
        status: 'active',
        reason: 'agent',
        since: minutesAgo(48 * 60),
        lastAgentAt: minutesAgo(24 * 60 + 1),
      });
      expect(await service.routeFor(PHONE)).toBe('bot');
      const conversation = client.conversations.get(id);
      expect(conversation?.messages.at(-1)).toMatchObject({ content: EXPIRED_NOTE, private: true });
      expect(conversation?.status).toBe('resolved');
      expect(states.size).toBe(0);
      expect(threads.size).toBe(0);
    });

    it('active com 23 h continua com o atendente', async () => {
      const { service } = await expiredSetup({
        status: 'active',
        reason: 'agent',
        since: minutesAgo(48 * 60),
        lastAgentAt: minutesAgo(23 * 60),
      });
      expect(await service.routeFor(PHONE)).toBe('agent');
    });

    it('queued há 72 h + 1 min expira igual', async () => {
      const { service, client, states, id } = await expiredSetup({
        status: 'queued',
        reason: 'customer_request',
        since: minutesAgo(72 * 60 + 1),
      });
      const outcome = await service.requestHandoff({
        phone: PHONE,
        reason: 'customer_request',
        summary: null,
      });
      expect(client.conversations.get(id)?.messages[0].content).toBe(EXPIRED_NOTE);
      expect(client.conversations.get(id)?.status).toBe('resolved');
      expect(outcome.status).toBe('queued');
      expect(states.get(PHONE)?.conversationId).not.toBe(id);
    });

    it('falha ao resolver no Chatwoot ainda apaga o estado', async () => {
      const { service, client, states } = await expiredSetup({
        status: 'queued',
        reason: 'customer_request',
        since: minutesAgo(72 * 60 + 1),
      });
      client.failNext();
      expect(await service.routeFor(PHONE)).toBe('bot');
      expect(states.size).toBe(0);
    });

    it('mensagem do atendente em active vencido não expira o próprio handoff', async () => {
      const { service, client, states, threads, id } = await expiredSetup({
        status: 'active',
        reason: 'agent',
        since: minutesAgo(48 * 60),
        lastAgentAt: minutesAgo(24 * 60 + 1),
      });
      await expect(service.markAgentMessage(PHONE, id)).resolves.toEqual({ becameActive: false });
      const conversation = client.conversations.get(id);
      expect(conversation?.messages.some(message => message.content === EXPIRED_NOTE)).toBe(false);
      expect(conversation?.status).toBe('open');
      expect(states.get(PHONE)).toEqual({
        status: 'active',
        conversationId: id,
        reason: 'agent',
        since: minutesAgo(48 * 60),
        lastAgentAt: NOW.toISOString(),
      });
      expect(threads.get(PHONE)).toEqual({ conversationId: id });
    });

    it('mensagem do atendente em queued vencido vira active sem nota de expiração', async () => {
      const { service, client, states, id } = await expiredSetup({
        status: 'queued',
        reason: 'customer_request',
        since: minutesAgo(72 * 60 + 1),
      });
      await expect(service.markAgentMessage(PHONE, id)).resolves.toEqual({ becameActive: true });
      const conversation = client.conversations.get(id);
      expect(conversation?.messages.some(message => message.content === EXPIRED_NOTE)).toBe(false);
      expect(conversation?.status).toBe('open');
      expect(states.get(PHONE)).toMatchObject({
        status: 'active',
        conversationId: id,
        reason: 'customer_request',
        lastAgentAt: NOW.toISOString(),
      });
    });
  });

  describe('endFromDesk', () => {
    it('id antigo não apaga o estado atual; id certo apaga', async () => {
      const { service, states, threads } = setup();
      states.set(PHONE, {
        status: 'active',
        conversationId: 20,
        reason: 'agent',
        since: NOW.toISOString(),
        lastAgentAt: NOW.toISOString(),
      });
      threads.set(PHONE, { conversationId: 20 });
      await service.endFromDesk(PHONE, 19);
      expect(states.size).toBe(1);
      expect(threads.size).toBe(1);
      await service.endFromDesk(PHONE, 20);
      expect(states.size).toBe(0);
      expect(threads.size).toBe(0);
    });
  });

  describe('forwardToAgent', () => {
    async function activeSetup() {
      const context = setup();
      const { id } = await context.client.createConversation({
        contactId: 1,
        sourceId: 's',
        status: 'open',
      });
      await context.service.markAgentMessage(PHONE, id);
      return { ...context, id };
    }

    it('mensagem não suportada vira o tipo em texto', async () => {
      const { service, client, id } = await activeSetup();
      await service.forwardToAgent(PHONE, { type: 'unsupported', originalType: 'audio' });
      await service.forwardToAgent(PHONE, { type: 'unsupported', originalType: 'contacts' });
      await service.forwardToAgent(PHONE, { type: 'unsupported' });
      expect(client.conversations.get(id)?.messages.map(m => [m.content, m.type])).toEqual([
        ['[cliente enviou áudio]', 'incoming'],
        ['[cliente enviou mensagem não suportada]', 'incoming'],
        ['[cliente enviou mensagem não suportada]', 'incoming'],
      ]);
    });

    it('texto com CPF é ocultado e falha não lança', async () => {
      const { service, client, id } = await activeSetup();
      await service.forwardToAgent(PHONE, { type: 'text', text: 'cpf 12345678909' });
      expect(client.conversations.get(id)?.messages[0].content).toBe('cpf [CPF ocultado]');
      client.failNext();
      await expect(
        service.forwardToAgent(PHONE, { type: 'text', text: 'oi' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('noteWindowClosed e claimDeskMessage', () => {
    it('posta a nota da janela e não lança em falha', async () => {
      const { service, client } = setup();
      const { id } = await client.createConversation({
        contactId: 1,
        sourceId: 's',
        status: 'open',
      });
      await service.noteWindowClosed(id);
      expect(client.conversations.get(id)?.messages[0].private).toBe(true);
      client.failNext();
      await expect(service.noteWindowClosed(id)).resolves.toBeUndefined();
    });

    it('noteWindowClosedFor posta a nota na conversa do handoff ativo ou na fila', async () => {
      const { service, client, states } = setup();
      const { id } = await client.createConversation({
        contactId: 1,
        sourceId: 's',
        status: 'open',
      });
      states.set(PHONE, {
        status: 'queued',
        conversationId: id,
        reason: 'customer_request',
        since: minutesAgo(5),
      });
      await service.noteWindowClosedFor(PHONE);
      expect(client.conversations.get(id)?.messages).toHaveLength(1);
      expect(client.conversations.get(id)?.messages[0].private).toBe(true);
      states.set(PHONE, { ...(states.get(PHONE) as HandoffState), status: 'active' });
      await service.noteWindowClosedFor(PHONE);
      expect(client.conversations.get(id)?.messages).toHaveLength(2);
    });

    it('noteWindowClosedFor não faz nada sem handoff nem com o desk desativado', async () => {
      const { service, client } = setup();
      const spy = vi.spyOn(client, 'createMessage');
      await service.noteWindowClosedFor(PHONE);
      expect(spy).not.toHaveBeenCalled();
      const off = setup({ disabled: true });
      off.states.set(PHONE, {
        status: 'active',
        conversationId: 1,
        reason: 'agent',
        since: minutesAgo(5),
      });
      await expect(off.service.noteWindowClosedFor(PHONE)).resolves.toBeUndefined();
    });

    it('noteWindowClosedFor não lança quando o Chatwoot falha', async () => {
      const { service, client, states } = setup();
      states.set(PHONE, {
        status: 'active',
        conversationId: 1,
        reason: 'agent',
        since: minutesAgo(5),
      });
      client.failNext();
      await expect(service.noteWindowClosedFor(PHONE)).resolves.toBeUndefined();
    });

    it('claimDeskMessage delega ao repositório', async () => {
      const { service } = setup();
      expect(await service.claimDeskMessage(1)).toBe(true);
      expect(await service.claimDeskMessage(1)).toBe(false);
    });
  });
});
