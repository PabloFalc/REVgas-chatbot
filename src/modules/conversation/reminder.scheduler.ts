import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { env } from 'src/config/env';
import { WhatsappError } from 'src/core/erros/whatsapp/whatsapp.errors';
import { maskPhone } from 'src/utils/mask';
import { HandoffService } from '../handoff/handoff.service';
import { BotEventsRepository } from '../metrics/bot-events.repository';
import { ConversationRepository } from './conversation.repository';
import { reminderFor } from './flow/reminder';
import { FlowToolsService } from './flow-tools';
import { MessagingGateway } from './messaging.gateway';
import { replyText } from './reply-text';

const TICK_INTERVAL_MS = 30_000;

type SkipReason = 'expired' | 'busy' | 'answered' | 'creatingSale';

function errorInfo(error: unknown) {
  if (error instanceof WhatsappError) {
    return { kind: error.kind, status: error.status, code: error.code };
  }
  return { kind: 'unexpected', name: error instanceof Error ? error.name : typeof error };
}

@Injectable()
export class ReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messaging: MessagingGateway,
    private readonly flowTools: FlowToolsService,
    private readonly handoff: HandoffService,
    private readonly logger: PinoLogger,
    private readonly events: BotEventsRepository,
  ) {
    this.logger.setContext(ReminderScheduler.name);
  }

  onModuleInit(): void {
    if (env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.conversations.dueReminders(new Date());
      for (const { phone, at } of due) {
        await this.remindSafely(phone, at);
      }
    } catch (error) {
      this.logger.error(
        { component: 'reminder', error: errorInfo(error) },
        'Falha na varredura de lembretes',
      );
    } finally {
      this.running = false;
    }
  }

  private async remindSafely(phone: string, at: number): Promise<void> {
    try {
      if (!(await this.conversations.claimReminder(phone, at))) return;
      const outcome = await this.conversations.tryPhoneLock(phone, () => this.remind(phone));
      if (!outcome.ran) this.skipped(phone, 'busy');
    } catch (error) {
      this.logger.error(
        { component: 'reminder', from: maskPhone(phone), error: errorInfo(error) },
        'Falha ao enviar lembrete',
      );
    }
  }

  private async remind(phone: string): Promise<void> {
    const state = await this.conversations.loadOrder(phone);
    if (!state) return this.skipped(phone, 'expired');
    if (state.step === 'creatingSale') return this.skipped(phone, 'creatingSale');

    state.cycleId ??= randomUUID();
    const tools = this.flowTools.forPhone(
      phone,
      next => this.conversations.saveOrderKeepingTtl(phone, { ...next, cycleId: state.cycleId }),
      state.cycleId,
    );
    const result = await reminderFor(state, tools);
    if (!result) return this.skipped(phone, 'answered');

    for (const reply of result.replies) {
      await this.messaging.send(phone, reply);
    }
    try {
      this.events.record({ name: 'reminder_sent', cycleId: state.cycleId, step: state.step });
    } catch {
      this.logger.warn('Falha ao gravar métrica');
    }
    if (result.state)
      await this.conversations.saveOrderKeepingTtl(phone, {
        ...result.state,
        cycleId: state.cycleId,
      });
    await this.handoff.mirrorOutgoing(phone, result.replies.map(replyText));
    this.logger.info(
      { component: 'reminder', from: maskPhone(phone), step: state.step },
      'Lembrete enviado',
    );
  }

  private skipped(phone: string, reason: SkipReason): void {
    this.logger.debug(
      { component: 'reminder', from: maskPhone(phone), reason },
      'Lembrete ignorado',
    );
  }
}
