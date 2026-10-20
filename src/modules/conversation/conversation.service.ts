import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { WhatsappError } from 'src/core/erros/whatsapp/whatsapp.errors';
import type {
  InboundMessageEvent,
  StatusEvent,
  WebhookEvent,
} from 'src/integrations/whatsapp/webhook/webhook.schemas';
import { maskPhone } from 'src/utils/mask';
import { normalizeText, truncate } from 'src/utils/text';
import type { IncomingMessage, Reply } from './contracts/conversation.types';
import { ConversationRepository } from './conversation.repository';
import { MessagingGateway } from './messaging.gateway';

const ECHO_LIMIT = 200;

const HELP = 'Envie *lista* ou *botões* para testar as mensagens interativas.';

const listDemo: Reply = {
  type: 'list',
  body: 'Qual produto você quer?',
  buttonText: 'Ver produtos',
  sections: [
    {
      title: 'Gás',
      rows: [
        { id: 'demo:p13', title: 'Botijão P13', description: 'Gás de cozinha, 13 kg' },
        { id: 'demo:p45', title: 'Botijão P45', description: 'Uso comercial, 45 kg' },
      ],
    },
    {
      title: 'Água',
      rows: [{ id: 'demo:agua20', title: 'Água 20 L', description: 'Galão retornável' }],
    },
  ],
};

const buttonsDemo: Reply = {
  type: 'buttons',
  body: 'Posso entregar no endereço salvo?',
  buttons: [
    { id: 'demo:sim', title: 'Sim' },
    { id: 'demo:alterar', title: 'Alterar endereço' },
    { id: 'demo:atendente', title: 'Falar com atendente' },
  ],
};

function firstName(name?: string): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `, ${first}` : '';
}

export function replyTo(message: IncomingMessage): Reply[] {
  const { content } = message;

  if (content.type === 'unsupported') {
    return [{ type: 'text', text: `Por enquanto só entendo mensagens de texto. ${HELP}` }];
  }

  if (content.type === 'choice') {
    return [{ type: 'text', text: `Você escolheu: *${content.title ?? content.id}*. ${HELP}` }];
  }

  const command = normalizeText(content.text);
  if (command === 'lista') {
    return [listDemo];
  }
  if (command === 'botoes' || command === 'botao') {
    return [buttonsDemo];
  }

  return [
    {
      type: 'text',
      text: `Olá${firstName(message.name)}! Recebi: "${truncate(content.text, ECHO_LIMIT)}"\n\n${HELP}`,
    },
  ];
}

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

    for (const reply of replyTo(toIncoming(event))) {
      try {
        await this.messaging.send(event.from, reply);
      } catch (error) {
        this.logger.error(
          { ...log, reply: reply.type, error: errorInfo(error) },
          'Falha ao responder no WhatsApp',
        );
        return;
      }
    }
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
