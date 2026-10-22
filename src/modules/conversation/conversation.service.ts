import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { WhatsappError } from 'src/core/erros/whatsapp/whatsapp.errors';
import type {
  InboundMessageEvent,
  StatusEvent,
  WebhookEvent,
} from 'src/integrations/whatsapp/webhook/webhook.schemas';
import { maskPhone } from 'src/utils/mask';
import type { IncomingMessage, Reply } from './contracts/conversation.types';
import { ConversationRepository } from './conversation.repository';
import { runFlow } from './flow/flow';
import type { ToolError } from './flow/flow.types';
import { FlowToolsService } from './flow-tools';
import { MessagingGateway } from './messaging.gateway';

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
          : { type: 'unsupported' },
  };
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
          this.onStatus(event);
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
      const replies = await this.advance(incoming, log);
      await this.sendAll(event.from, replies, log);
    });
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

  private async advance(incoming: IncomingMessage, log: object): Promise<Reply[]> {
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
    } else {
      await this.conversations.saveOrder(phone, result.state);
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
    return result.replies;
  }

  private onStatus(event: StatusEvent): void {
    const log = {
      component: 'conversation',
      messageId: event.id,
      status: event.status,
      recipient: event.recipient ? maskPhone(event.recipient) : undefined,
    };
    if (event.status === 'failed') {
      this.logger.warn({ ...log, errorCodes: event.errorCodes }, 'Mensagem não entregue');
      return;
    }
    this.logger.debug(log, 'Status de mensagem');
  }
}
