import type { PinoLogger } from 'nestjs-pino';
import { WhatsappRejectedError } from 'src/core/erros/whatsapp/whatsapp.errors';
import { FakeWhatsappClient } from 'src/integrations/whatsapp/fake-whatsapp.client';
import type { DeskEvent, HandoffState } from 'src/modules/handoff/contracts/handoff.types';
import { DeskGateway } from 'src/modules/handoff/desk.gateway';
import type { HandoffRepository } from 'src/modules/handoff/handoff.repository';
import { HandoffService } from 'src/modules/handoff/handoff.service';
import type { BotEventsRepository } from 'src/modules/metrics/bot-events.repository';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationRepository, LockOutcome } from './conversation.repository';
import { DeskEventsService } from './desk-events.service';
import { MessagingGateway } from './messaging.gateway';

const PHONE = '5586999991234';

function agentEvent(
  overrides: Partial<Extract<DeskEvent, { kind: 'agentMessage' }>> = {},
): DeskEvent {
  return {
    kind: 'agentMessage',
    messageId: 100,
    conversationId: 10,
    inboxId: 1,
    phone: PHONE,
    agentName: 'Maria',
    content: 'Olá, tudo bem?',
    ...overrides,
  };
}

function setup(whatsapp = new FakeWhatsappClient()) {
  const order: string[] = [];
  const claimed = new Set<number>();
  const conversations = {
    withPhoneLock: vi.fn(
      async (_phone: string, work: () => Promise<unknown>): Promise<LockOutcome<unknown>> => {
        order.push('lock');
        return { ran: true, value: await work() };
      },
    ),
    clearOrder: vi.fn(async () => {
      order.push('clearOrder');
    }),
    cancelReminder: vi.fn(async () => undefined),
  };
  const handoff = {
    claimDeskMessage: vi.fn(async (id: number) => {
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    }),
    releaseDeskMessage: vi.fn(async (id: number) => {
      claimed.delete(id);
    }),
    markAgentMessage: vi.fn(async () => ({ accepted: true, becameActive: true })),
    endFromDesk: vi.fn(async () => undefined),
    noteWindowClosed: vi.fn(async () => undefined),
  };
  const logger = {
    setContext: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const service = new DeskEventsService(
    conversations as unknown as ConversationRepository,
    new MessagingGateway(whatsapp),
    handoff as unknown as HandoffService,
    logger as unknown as PinoLogger,
  );
  return { service, conversations, handoff, whatsapp, logger, order };
}

describe('DeskEventsService.handle', () => {
  it('mensagem humana é repassada ao WhatsApp dentro do lock', async () => {
    const { service, conversations, whatsapp, order } = setup();

    await service.handle([agentEvent()]);

    expect(order).toEqual(['lock']);
    expect(conversations.withPhoneLock).toHaveBeenCalledWith(PHONE, expect.any(Function));
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]).toMatchObject({
      type: 'text',
      to: PHONE,
      body: { text: { body: '*Maria (atendente):* Olá, tudo bem?' } },
    });
  });

  it('preserva o rascunho quando o agente assume o atendimento', async () => {
    const { service, conversations, whatsapp } = setup();

    await service.handle([agentEvent()]);

    expect(conversations.cancelReminder).toHaveBeenCalledWith(PHONE);
    expect(conversations.clearOrder).not.toHaveBeenCalled();
    expect(whatsapp.sent).toHaveLength(1);
  });

  it('ignora mensagem de agente sem handoff aberto', async () => {
    const { service, handoff, conversations, whatsapp, logger } = setup();
    handoff.markAgentMessage.mockResolvedValue({ accepted: false, becameActive: false });

    await service.handle([agentEvent()]);

    expect(whatsapp.sent).toEqual([]);
    expect(conversations.clearOrder).not.toHaveBeenCalled();
    expect(conversations.cancelReminder).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      { component: 'desk-events', kind: 'agentMessage' },
      'Mensagem de agente ignorada: sem handoff correspondente',
    );
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(PHONE);
  });

  it('falha ao cancelar o lembrete não impede o repasse e vai para o log sem o telefone cru', async () => {
    const { service, conversations, whatsapp, logger } = setup();
    conversations.cancelReminder.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await service.handle([agentEvent()]);

    expect(whatsapp.sent).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { component: 'desk-events', phone: '*******1234', error: 'Error' },
      'Falha ao cancelar o lembrete ao assumir o atendimento',
    );
  });

  it('o mesmo messageId duas vezes envia uma vez só', async () => {
    const { service, whatsapp } = setup();

    await service.handle([agentEvent(), agentEvent()]);

    expect(whatsapp.sent).toHaveLength(1);
  });

  it('não duplica a transição de assunção para evento repetido', async () => {
    const { service, handoff, conversations } = setup();

    await service.handle([agentEvent(), agentEvent()]);

    expect(handoff.markAgentMessage).toHaveBeenCalledOnce();
    expect(conversations.cancelReminder).toHaveBeenCalledOnce();
  });

  it('já ativo não cancela o lembrete, mas envia', async () => {
    const { service, handoff, conversations, whatsapp } = setup();
    handoff.markAgentMessage.mockResolvedValue({ accepted: true, becameActive: false });

    await service.handle([agentEvent()]);

    expect(conversations.cancelReminder).not.toHaveBeenCalled();
    expect(whatsapp.sent).toHaveLength(1);
  });

  it('evento sem telefone é ignorado', async () => {
    const { service, handoff, whatsapp } = setup();

    await service.handle([agentEvent({ phone: null })]);

    expect(handoff.claimDeskMessage).not.toHaveBeenCalled();
    expect(whatsapp.sent).toEqual([]);
  });

  it('erro 131047 no envio avisa a janela fechada', async () => {
    const { service, handoff, whatsapp } = setup();
    vi.spyOn(whatsapp, 'sendText').mockRejectedValue(
      new WhatsappRejectedError('Janela fechada', 400, 131047),
    );

    await service.handle([agentEvent()]);

    expect(handoff.noteWindowClosed).toHaveBeenCalledWith(10);
  });

  it('outro erro só vai para o log e não impede os próximos eventos', async () => {
    const { service, handoff, whatsapp, logger } = setup();
    vi.spyOn(whatsapp, 'sendText').mockRejectedValueOnce(new Error('boom'));

    await service.handle([agentEvent(), agentEvent({ messageId: 101 })]);

    expect(handoff.noteWindowClosed).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    expect(whatsapp.sent).toHaveLength(1);
  });

  it('limita o texto a 4096 caracteres', async () => {
    const { service, whatsapp } = setup();

    await service.handle([agentEvent({ content: 'Z'.repeat(5000) })]);

    const body = JSON.stringify(whatsapp.sent[0]?.body);
    expect(body.match(/Z/g)?.length).toBe(4096 - '*Maria (atendente):* '.length - 1);
    expect(body.length).toBeLessThan(4400);
    expect(body).toContain('…');
  });

  it('conversa resolvida encerra o handoff dentro do lock', async () => {
    const { service, handoff, conversations } = setup();

    await service.handle([
      { kind: 'conversationResolved', conversationId: 10, inboxId: 1, phone: PHONE },
    ]);

    expect(conversations.withPhoneLock).toHaveBeenCalledWith(PHONE, expect.any(Function));
    expect(handoff.endFromDesk).toHaveBeenCalledWith(PHONE, 10);
  });

  it('lock ocupado não repassa a mensagem e avisa no log sem o telefone cru', async () => {
    const { service, conversations, whatsapp, logger } = setup();
    conversations.withPhoneLock.mockResolvedValueOnce({ ran: false });

    await service.handle([agentEvent()]);

    expect(whatsapp.sent).toEqual([]);
    expect(conversations.cancelReminder).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { component: 'desk-events', kind: 'agentMessage', phone: '*******1234' },
      'Lock do telefone não liberou a tempo; evento não processado',
    );
  });

  it('lock ocupado libera a mensagem para a reentrega ser repassada', async () => {
    const { service, conversations, handoff, whatsapp } = setup();
    conversations.withPhoneLock.mockResolvedValueOnce({ ran: false });

    await service.handle([agentEvent()]);
    await service.handle([agentEvent()]);

    expect(handoff.releaseDeskMessage).toHaveBeenCalledWith(100);
    expect(whatsapp.sent).toHaveLength(1);
  });

  it('mensagem repassada não é liberada', async () => {
    const { service, handoff } = setup();

    await service.handle([agentEvent()]);

    expect(handoff.releaseDeskMessage).not.toHaveBeenCalled();
  });

  it('não limpa handoff ao resolver conversa de outro ciclo', async () => {
    let state: HandoffState | null = {
      status: 'active',
      conversationId: 20,
      reason: 'customer_request',
      since: '2026-11-09T10:00:00.000Z',
      requestedAt: '2026-11-09T09:50:00.000Z',
      assumedAt: '2026-11-09T10:00:00.000Z',
      handoffId: '0b6f6c1e-2d1c-4e53-9a43-5b1f1f3e7a10',
    };
    const repo = {
      getState: vi.fn(async () => state),
      clearState: vi.fn(async () => {
        state = null;
      }),
      getThread: vi.fn(async () => ({ conversationId: 20 })),
      clearThread: vi.fn(async () => undefined),
    };
    const events = { record: vi.fn() };
    const realHandoff = new HandoffService(
      repo as unknown as HandoffRepository,
      new DeskGateway(null, { mode: 'off', baseUrl: '', timeoutMs: 1, inboxId: 1 }),
      { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger,
      { now: () => new Date('2026-11-09T10:10:00.000Z') },
      [],
      events as unknown as BotEventsRepository,
    );
    const withRealHandoff = new DeskEventsService(
      {
        withPhoneLock: async (_phone: string, work: () => Promise<unknown>) => ({
          ran: true,
          value: await work(),
        }),
      } as unknown as ConversationRepository,
      new MessagingGateway(new FakeWhatsappClient()),
      realHandoff,
      { setContext: vi.fn(), debug: vi.fn(), warn: vi.fn() } as unknown as PinoLogger,
    );

    await withRealHandoff.handle([
      { kind: 'conversationResolved', conversationId: 19, inboxId: 1, phone: PHONE },
    ]);

    expect(state).not.toBeNull();
    expect(repo.clearState).not.toHaveBeenCalled();
    expect(repo.clearThread).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();

    await withRealHandoff.handle([
      { kind: 'conversationResolved', conversationId: 20, inboxId: 1, phone: PHONE },
    ]);

    expect(state).toBeNull();
    expect(events.record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: 'handoff_resolved', durationMs: 600_000 }),
    );
  });
});
