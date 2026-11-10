import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { WhatsappError } from 'src/core/erros/whatsapp/whatsapp.errors';
import type {
  InboundMessageEvent,
  StatusEvent,
  WebhookEvent,
} from 'src/integrations/whatsapp/webhook/webhook.schemas';
import type { DeskInbound } from 'src/modules/handoff/contracts/handoff.types';
import { HandoffService } from 'src/modules/handoff/handoff.service';
import { maskPhone } from 'src/utils/mask';
import type { IncomingContent, IncomingMessage, Reply } from './contracts/conversation.types';
import { ConversationRepository } from './conversation.repository';
import { runFlow } from './flow/flow';
import { CPF_STEPS, type OrderState, type StepResult, type ToolError } from './flow/flow.types';
import { REMINDER_AFTER_MS } from './flow/reminder';
import { WINDOW_CLOSED_CODE } from './desk-events.service';
import { FlowToolsService } from './flow-tools';
import { MessagingGateway } from './messaging.gateway';
import { replyText } from './reply-text';

function toIncoming(event: InboundMessageEvent): IncomingMessage {
  const { content } = event;
  return {
    id: event.id,
    from: event.from,
    name: event.name,
    content:
      content.type === 'text'
        ? { type: 'text', text: content.text }
        : content.type === 'reply'
          ? { type: 'choice', id: content.replyId, title: content.title }
          : { type: 'unsupported', originalType: content.originalType },
  };
}

function toDeskInbound(content: IncomingContent): DeskInbound {
  if (content.type === 'text') return { type: 'text', text: content.text };
  if (content.type === 'choice') return { type: 'choice', title: content.title ?? content.id };
  return { type: 'unsupported', originalType: content.originalType };
}

function errorInfo(error: unknown) {
  if (error instanceof WhatsappError) {
    return { kind: error.kind, status: error.status, code: error.code };
  }
  return { kind: 'unexpected', message: error instanceof Error ? error.message : String(error) };
}

@Injectable()
export class ConversationService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messaging: MessagingGateway,
    private readonly flowTools: FlowToolsService,
    private readonly handoff: HandoffService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConversationService.name);
  }

  async handle(events: WebhookEvent[]): Promise<void> {
    for (const event of events) {
      try {
        if (event.kind === 'message') {
          await this.onMessage(event);
        } else {
          await this.onStatus(event);
        }
      } catch (error) {
        this.logger.error(
          { component: 'conversation', messageId: event.id, error: errorInfo(error) },
          'Falha ao processar evento do WhatsApp',
        );
      }
    }
  }

  private async onMessage(event: InboundMessageEvent): Promise<void> {
    const log = {
      component: 'conversation',
      messageId: event.id,
      from: maskPhone(event.from),
      type: event.content.type,
    };

    if (!(await this.conversations.claimMessage(event.id))) {
      this.logger.debug(log, 'Mensagem repetida ignorada');
      return;
    }

    this.logger.info(log, 'Mensagem recebida');

    try {
      await this.messaging.markAsRead(event.id);
    } catch (error) {
      this.logger.warn({ ...log, error: errorInfo(error) }, 'Falha ao marcar mensagem como lida');
    }

    const incoming = toIncoming(event);
    await this.conversations.withPhoneLock(event.from, async () => {
      const inbound = toDeskInbound(incoming.content);
      if ((await this.handoff.routeFor(event.from)) === 'agent') {
        await this.forward(event.from, inbound, log);
        return;
      }
      const { replies, before, result } = await this.advance(incoming, log);
      await this.sendAll(event.from, replies, log);
      await this.mirror(incoming, inbound, replies, before, result, log);
    });
  }

  private async forward(phone: string, inbound: DeskInbound, log: object): Promise<void> {
    try {
      await this.handoff.forwardToAgent(phone, inbound);
      this.logger.info(log, 'Mensagem repassada ao atendente');
    } catch (error) {
      this.logger.warn({ ...log, error: errorInfo(error) }, 'Falha ao repassar ao atendente');
    }
  }

  private async mirror(
    incoming: IncomingMessage,
    inbound: DeskInbound,
    replies: Reply[],
    before: OrderState | null,
    result: StepResult,
    log: object,
  ): Promise<void> {
    try {
      await this.handoff.recordTurn({
        phone: incoming.from,
        name: incoming.name,
        inbound,
        sensitive: before !== null && CPF_STEPS.includes(before.step),
        botMessages: replies.map(replyText),
        newCycle: before === null,
        ended: result.state === null,
        saleId: result.saleId,
      });
    } catch (error) {
      this.logger.warn({ ...log, error: errorInfo(error) }, 'Falha ao espelhar a conversa');
    }
  }

  private async sendAll(to: string, replies: Reply[], log: object): Promise<void> {
    for (const reply of replies) {
      try {
        await this.messaging.send(to, reply);
      } catch (error) {
        this.logger.error(
          { ...log, reply: reply.type, error: errorInfo(error) },
          'Falha ao responder no WhatsApp',
        );
        return;
      }
    }
  }

  private async advance(
    incoming: IncomingMessage,
    log: object,
  ): Promise<{ replies: Reply[]; before: OrderState | null; result: StepResult }> {
    const phone = incoming.from;
    const tools = this.flowTools.forPhone(state => this.conversations.saveOrder(phone, state));
    const before = await this.conversations.loadOrder(phone);
    const result = await runFlow(
      before,
      { phone, content: incoming.content },
      tools,
      (error: ToolError) => {
        this.logger.warn(
          {
            ...log,
            cause: error.cause instanceof Error ? error.cause.name : typeof error.cause,
          },
          'Falha em ferramenta do fluxo',
        );
      },
    );

    if (result.saleId !== undefined) {
      this.logger.info(
        {
          component: 'conversation',
          phone: maskPhone(phone),
          messageId: incoming.id,
          saleId: result.saleId,
        },
        'Venda criada',
      );
    }

    if (result.state === null) {
      await this.conversations.clearOrder(phone);
      await this.conversations.cancelReminder(phone);
    } else {
      const now = new Date();
      await this.conversations.saveOrder(phone, {
        ...result.state,
        lastInboundAt: now.toISOString(),
      });
      await this.conversations.scheduleReminder(phone, new Date(now.getTime() + REMINDER_AFTER_MS));
    }

    this.logger.info(
      {
        ...log,
        input: incoming.content.type,
        stepBefore: before?.step ?? null,
        stepAfter: result.state?.step ?? null,
        replies: result.replies.length,
      },
      'Fluxo de pedido avançou',
    );
    return { replies: result.replies, before, result };
  }

  private async onStatus(event: StatusEvent): Promise<void> {
    const log = {
      component: 'conversation',
      messageId: event.id,
      status: event.status,
      recipient: event.recipient ? maskPhone(event.recipient) : undefined,
    };
    if (event.status === 'failed') {
      this.logger.warn({ ...log, errorCodes: event.errorCodes }, 'Mensagem não entregue');
      if (event.recipient && event.errorCodes.includes(WINDOW_CLOSED_CODE)) {
        await this.handoff.noteWindowClosedFor(event.recipient);
      }
      return;
    }
    this.logger.debug(log, 'Status de mensagem');
  }
}
