import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { WhatsappError } from 'src/core/erros/whatsapp/whatsapp.errors';
import type { DeskEvent } from 'src/modules/handoff/contracts/handoff.types';
import { HandoffService } from 'src/modules/handoff/handoff.service';
import { maskPhone } from 'src/utils/mask';
import { truncate } from 'src/utils/text';
import { ConversationRepository } from './conversation.repository';
import { MessagingGateway } from './messaging.gateway';

const WHATSAPP_TEXT_LIMIT = 4096;
export const WINDOW_CLOSED_CODE = 131047;

type AgentMessage = Extract<DeskEvent, { kind: 'agentMessage' }>;

@Injectable()
export class DeskEventsService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messaging: MessagingGateway,
    private readonly handoff: HandoffService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DeskEventsService.name);
  }

  async handle(events: DeskEvent[]): Promise<void> {
    for (const event of events) {
      try {
        await this.handleEvent(event);
      } catch (error) {
        this.logger.warn(
          {
            component: 'desk-events',
            kind: event.kind,
            phone: event.phone ? maskPhone(event.phone) : undefined,
            error: error instanceof Error ? error.name : 'unknown',
          },
          'Falha ao tratar evento do Chatwoot',
        );
      }
    }
  }

  private async handleEvent(event: DeskEvent): Promise<void> {
    const { phone } = event;
    if (phone === null) {
      this.logger.debug({ component: 'desk-events', kind: event.kind }, 'Evento sem telefone');
      return;
    }
    if (event.kind === 'conversationResolved') {
      await this.underLock(phone, event.kind, () =>
        this.handoff.endFromDesk(phone, event.conversationId),
      );
      return;
    }
    if (!(await this.handoff.claimDeskMessage(event.messageId))) {
      return;
    }
    const ran = await this.underLock(phone, event.kind, () => this.relayAgentMessage(phone, event));
    if (!ran) {
      await this.handoff.releaseDeskMessage(event.messageId);
    }
  }

  private async underLock(
    phone: string,
    kind: DeskEvent['kind'],
    work: () => Promise<void>,
  ): Promise<boolean> {
    const outcome = await this.conversations.withPhoneLock(phone, work);
    if (outcome.ran) return true;
    this.logger.warn(
      { component: 'desk-events', kind, phone: maskPhone(phone) },
      'Lock do telefone não liberou a tempo; evento não processado',
    );
    return false;
  }

  private async relayAgentMessage(phone: string, event: AgentMessage): Promise<void> {
    const { becameActive } = await this.handoff.markAgentMessage(phone, event.conversationId);
    if (becameActive) {
      await this.conversations.clearOrder(phone);
      await this.conversations.cancelReminder(phone);
    }
    const text = truncate(
      `*${event.agentName} (atendente):* ${event.content}`,
      WHATSAPP_TEXT_LIMIT - 1,
    );
    try {
      await this.messaging.send(phone, { type: 'text', text });
    } catch (error) {
      if (error instanceof WhatsappError && error.code === WINDOW_CLOSED_CODE) {
        await this.handoff.noteWindowClosed(event.conversationId);
        return;
      }
      throw error;
    }
  }
}
