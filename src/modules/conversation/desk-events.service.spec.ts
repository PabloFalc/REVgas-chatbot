import type { PinoLogger } from 'nestjs-pino';
import { WhatsappRejectedError } from 'src/core/erros/whatsapp/whatsapp.errors';
import { FakeWhatsappClient } from 'src/integrations/whatsapp/fake-whatsapp.client';
import type { DeskEvent } from 'src/modules/handoff/contracts/handoff.types';
import type { HandoffService } from 'src/modules/handoff/handoff.service';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationRepository } from './conversation.repository';
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
    withPhoneLock: vi.fn(async (_phone: string, work: () => Promise<unknown>) => {
      order.push('lock');
      return work();
    }),
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
    markAgentMessage: vi.fn(async () => ({ becameActive: true })),
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
  it('mensagem humana apaga o pedido dentro do lock e repassa ao WhatsApp', async () => {
    const { service, conversations, whatsapp, order } = setup();

    await service.handle([agentEvent()]);

    expect(order).toEqual(['lock', 'clearOrder']);
    expect(conversations.withPhoneLock).toHaveBeenCalledWith(PHONE, expect.any(Function));
    expect(conversations.clearOrder).toHaveBeenCalledWith(PHONE);
    expect(conversations.cancelReminder).toHaveBeenCalledWith(PHONE);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]).toMatchObject({
      type: 'text',
      to: PHONE,
      body: { text: { body: '*Maria (atendente):* Olá, tudo bem?' } },
    });
  });

  it('o mesmo messageId duas vezes envia uma vez só', async () => {
    const { service, whatsapp } = setup();

    await service.handle([agentEvent(), agentEvent()]);

    expect(whatsapp.sent).toHaveLength(1);
  });

  it('já ativo não apaga o pedido, mas envia', async () => {
    const { service, handoff, conversations, whatsapp } = setup();
    handoff.markAgentMessage.mockResolvedValue({ becameActive: false });

    await service.handle([agentEvent()]);

    expect(conversations.clearOrder).not.toHaveBeenCalled();
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
});
