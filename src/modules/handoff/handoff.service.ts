import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ChatwootError } from 'src/core/erros/chatwoot/chatwoot.errors';
import type { BotEventsRepository } from 'src/modules/metrics/bot-events.repository';
import { hideCpfs } from 'src/utils/cpf';
import { maskPhone } from 'src/utils/mask';
import { isOpenAt, nextOpening, type ServiceWindow } from 'src/utils/service-hours';
import type {
  DeskInbound,
  HandoffOutcome,
  HandoffRequest,
  HandoffState,
  HandoffStatus,
  ServiceHoursInfo,
} from './contracts/handoff.types';
import {
  EMERGENCY_NOTE,
  EXPIRED_NOTE,
  handoffNote,
  saleNote,
  WINDOW_CLOSED_NOTE,
} from './contracts/handoff-note';
import { DeskGateway } from './desk.gateway';
import { HandoffRepository } from './handoff.repository';

export const HANDOFF_CLOCK = Symbol('HANDOFF_CLOCK');
export const SERVICE_HOURS = Symbol('SERVICE_HOURS');

export interface HandoffClock {
  now(): Date;
}

export interface TurnRecord {
  phone: string;
  name?: string;
  inbound: DeskInbound;
  sensitive: boolean;
  botMessages: string[];
  newCycle: boolean;
  ended: boolean;
  saleId?: number;
}

const HOUR_MS = 3_600_000;
const ACTIVE_EXPIRY_MS = 24 * HOUR_MS;
const QUEUED_EXPIRY_MS = 72 * HOUR_MS;
const HIDDEN_CPF = '[CPF ocultado]';

const UNSUPPORTED_LABELS: Record<string, string> = {
  audio: 'áudio',
  image: 'imagem',
  video: 'vídeo',
  document: 'documento',
  sticker: 'figurinha',
  location: 'localização',
};

function deskText(inbound: DeskInbound, sensitive: boolean): string {
  if (sensitive) return HIDDEN_CPF;
  switch (inbound.type) {
    case 'text':
      return hideCpfs(inbound.text);
    case 'choice':
      return hideCpfs(inbound.title);
    case 'unsupported': {
      const label = inbound.originalType ? UNSUPPORTED_LABELS[inbound.originalType] : undefined;
      return `[cliente enviou ${label ?? 'mensagem não suportada'}]`;
    }
  }
}

function errorKind(error: unknown): string {
  if (error instanceof ChatwootError) return error.kind;
  return error instanceof Error ? error.name : 'unknown';
}

function isGone(error: unknown): boolean {
  return error instanceof ChatwootError && error.kind === 'not_found';
}

function isExpired(state: HandoffState, now: Date): boolean {
  if (state.status === 'active') {
    const last = Date.parse(state.lastAgentAt ?? state.since);
    return now.getTime() - last > ACTIVE_EXPIRY_MS;
  }
  return now.getTime() - Date.parse(state.since) > QUEUED_EXPIRY_MS;
}

@Injectable()
export class HandoffService {
  private readonly clock: HandoffClock;
  private readonly hours: ServiceWindow[];

  constructor(
    private readonly repo: HandoffRepository,
    private readonly desk: DeskGateway,
    private readonly logger: PinoLogger,
    @Optional() @Inject(HANDOFF_CLOCK) clock?: HandoffClock,
    @Optional() @Inject(SERVICE_HOURS) hours?: ServiceWindow[],
    @Optional() private readonly events?: BotEventsRepository,
  ) {
    this.clock = clock ?? { now: () => new Date() };
    this.hours = hours ?? [];
    this.logger.setContext(HandoffService.name);
  }

  serviceHours(): ServiceHoursInfo {
    const now = this.clock.now();
    return {
      open: isOpenAt(this.hours, now),
      nextOpening: nextOpening(this.hours, now),
      windows: this.hours,
    };
  }

  async requestHandoff(request: HandoffRequest): Promise<HandoffOutcome> {
    const { open, nextOpening: opening } = this.serviceHours();
    const outcome = (status: HandoffStatus): HandoffOutcome => ({
      status,
      open,
      nextOpening: opening,
    });
    if (!this.desk.enabled) return outcome('unavailable');
    const { phone } = request;
    try {
      return await this.retryIfGone(phone, () => this.handoff(request, outcome));
    } catch (error) {
      this.warn(phone, error, 'Falha ao transferir para o atendente');
      return outcome('unavailable');
    }
  }

  private async handoff(
    request: HandoffRequest,
    outcome: (status: HandoffStatus) => HandoffOutcome,
  ): Promise<HandoffOutcome> {
    const { phone } = request;
    const state = await this.activeState(phone);
    if (state && request.reason === 'emergency') {
      await this.postEmergencyNote(phone, state.conversationId);
    }
    if (state?.status === 'queued') return outcome('alreadyQueued');
    if (state?.status === 'active') return outcome('active');
    const conversationId = await this.ensureThread(phone);
    await this.desk.postNote(
      conversationId,
      hideCpfs(handoffNote(request.reason, request.summary)),
    );
    await this.desk.setStatus(conversationId, 'open');
    const requestedAt = this.clock.now().toISOString();
    await this.repo.saveState(phone, {
      status: 'queued',
      conversationId,
      reason: request.reason,
      since: requestedAt,
      requestedAt,
      handoffId: randomUUID(),
      ...(request.cycleId ? { cycleId: request.cycleId } : {}),
    });
    return outcome('queued');
  }

  async routeFor(phone: string): Promise<'bot' | 'agent'> {
    const state = await this.activeState(phone);
    return state?.status === 'active' ? 'agent' : 'bot';
  }

  async forwardToAgent(phone: string, inbound: DeskInbound): Promise<void> {
    if (!this.desk.enabled) return;
    try {
      const state = await this.activeState(phone);
      if (!state) return;
      await this.desk.postIncoming(state.conversationId, deskText(inbound, false));
    } catch (error) {
      await this.forgetIfGone(phone, error);
      this.warn(phone, error, 'Falha ao repassar mensagem ao atendente');
    }
  }

  async flagEmergency(phone: string): Promise<void> {
    if (!this.desk.enabled) return;
    try {
      const state = await this.activeState(phone);
      if (!state) return;
      await this.postEmergencyNote(phone, state.conversationId);
    } catch (error) {
      await this.forgetIfGone(phone, error);
      this.warn(phone, error, 'Falha ao avisar a emergência ao atendente');
    }
  }

  async recordTurn(turn: TurnRecord): Promise<void> {
    if (!this.desk.enabled) return;
    try {
      await this.retryIfGone(turn.phone, () => this.mirrorTurn(turn));
    } catch (error) {
      this.warn(turn.phone, error, 'Falha ao espelhar a conversa no Chatwoot');
    }
  }

  private async mirrorTurn(turn: TurnRecord): Promise<void> {
    const { phone } = turn;
    const state = await this.activeState(phone);
    if (!state && turn.newCycle) await this.resolveStaleThread(phone);
    const conversationId = state?.conversationId ?? (await this.ensureThread(phone, turn.name));
    await this.desk.postIncoming(conversationId, deskText(turn.inbound, turn.sensitive));
    for (const message of turn.botMessages) {
      await this.desk.postOutgoing(conversationId, hideCpfs(message));
    }
    if (turn.saleId !== undefined && state?.status === 'queued') {
      await this.desk.postNote(conversationId, saleNote(turn.saleId));
      await this.desk.setStatus(conversationId, 'resolved');
      await this.repo.clearState(phone);
      await this.repo.clearThread(phone);
    } else if (turn.ended && !state) {
      await this.desk.setStatus(conversationId, 'resolved');
      await this.repo.clearThread(phone);
    }
  }

  async mirrorOutgoing(phone: string, texts: string[]): Promise<void> {
    if (!this.desk.enabled) return;
    try {
      const thread = await this.repo.getThread(phone);
      if (!thread) return;
      for (const text of texts) {
        await this.desk.postOutgoing(thread.conversationId, hideCpfs(text));
      }
    } catch (error) {
      await this.forgetIfGone(phone, error);
      this.warn(phone, error, 'Falha ao espelhar o lembrete no Chatwoot');
    }
  }

  async markAgentMessage(
    phone: string,
    conversationId: number,
  ): Promise<{ becameActive: boolean }> {
    if (!this.desk.enabled) return { becameActive: false };
    const previous = await this.repo.getState(phone);
    const now = this.clock.now().toISOString();
    if (previous?.status === 'active') {
      await this.repo.saveState(phone, { ...previous, conversationId, lastAgentAt: now });
      await this.repo.saveThread(phone, { conversationId });
      return { becameActive: false };
    }
    const requestedAt = previous ? (previous.requestedAt ?? previous.since) : undefined;
    const handoffId = previous?.handoffId ?? randomUUID();
    await this.repo.saveState(phone, {
      ...previous,
      status: 'active',
      conversationId,
      reason: previous?.reason ?? 'agent',
      since: now,
      handoffId,
      ...(requestedAt ? { requestedAt } : {}),
      assumedAt: now,
      lastAgentAt: now,
    });
    await this.repo.saveThread(phone, { conversationId });
    if (previous && requestedAt) {
      this.emit('handoff_assumed', previous, handoffId, Date.parse(now) - Date.parse(requestedAt));
    }
    return { becameActive: true };
  }

  async endFromDesk(phone: string, conversationId: number): Promise<void> {
    const state = await this.repo.getState(phone);
    if (state?.conversationId === conversationId) {
      if (state.status === 'active') {
        const resolvedAt = this.clock.now();
        const assumedAt = Date.parse(state.assumedAt ?? state.since);
        this.emit(
          'handoff_resolved',
          state,
          state.handoffId ?? randomUUID(),
          resolvedAt.getTime() - assumedAt,
        );
      }
      await this.repo.clearState(phone);
    }
    const thread = await this.repo.getThread(phone);
    if (thread?.conversationId === conversationId) await this.repo.clearThread(phone);
  }

  async noteWindowClosed(conversationId: number): Promise<void> {
    if (!this.desk.enabled) return;
    try {
      await this.desk.postNote(conversationId, WINDOW_CLOSED_NOTE);
    } catch (error) {
      this.logger.warn(
        { component: 'handoff', error: errorKind(error) },
        'Falha ao avisar a janela de 24 h',
      );
    }
  }

  async noteWindowClosedFor(phone: string): Promise<void> {
    if (!this.desk.enabled) return;
    try {
      const state = await this.repo.getState(phone);
      if (!state) return;
      await this.desk.postNote(state.conversationId, WINDOW_CLOSED_NOTE);
    } catch (error) {
      await this.forgetIfGone(phone, error);
      this.warn(phone, error, 'Falha ao avisar a janela de 24 h');
    }
  }

  claimDeskMessage(messageId: number): Promise<boolean> {
    return this.repo.claimDeskMessage(messageId);
  }

  releaseDeskMessage(messageId: number): Promise<void> {
    return this.repo.releaseDeskMessage(messageId);
  }

  private async activeState(phone: string): Promise<HandoffState | null> {
    const state = await this.repo.getState(phone);
    if (!state) return null;
    const now = this.clock.now();
    if (!isExpired(state, now)) return state;
    this.emit(
      'handoff_expired',
      state,
      state.handoffId ?? randomUUID(),
      now.getTime() - Date.parse(state.requestedAt ?? state.since),
    );
    if (this.desk.enabled) {
      try {
        await this.desk.postNote(state.conversationId, EXPIRED_NOTE);
        await this.desk.setStatus(state.conversationId, 'resolved');
      } catch (error) {
        this.warn(phone, error, 'Falha ao resolver handoff expirado');
      }
    }
    await this.repo.clearState(phone);
    await this.repo.clearThread(phone);
    return null;
  }

  private emit(
    name: 'handoff_assumed' | 'handoff_resolved' | 'handoff_expired',
    state: HandoffState,
    handoffId: string,
    durationMs: number,
  ): void {
    this.events?.record({
      name,
      cycleId: state.cycleId,
      handoffId,
      durationMs: Math.max(0, durationMs),
    });
  }

  private async postEmergencyNote(phone: string, conversationId: number): Promise<void> {
    try {
      await this.desk.postNote(conversationId, EMERGENCY_NOTE);
    } catch (error) {
      this.warn(phone, error, 'Falha ao avisar a emergência ao atendente');
    }
  }

  private async resolveStaleThread(phone: string): Promise<void> {
    const thread = await this.repo.getThread(phone);
    if (!thread) return;
    try {
      await this.desk.setStatus(thread.conversationId, 'resolved');
    } catch (error) {
      this.warn(phone, error, 'Falha ao resolver a conversa antiga');
    }
    await this.repo.clearThread(phone);
  }

  private async ensureThread(phone: string, name?: string): Promise<number> {
    const thread = await this.repo.getThread(phone);
    if (thread) return thread.conversationId;
    const cached = await this.repo.getContact(phone);
    const contact = await this.desk.ensureContact(phone, name, cached);
    if (contact !== cached) await this.repo.saveContact(phone, contact);
    const conversationId = await this.desk.openConversation(contact);
    await this.repo.saveThread(phone, { conversationId });
    return conversationId;
  }

  private async retryIfGone<T>(phone: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!isGone(error)) throw error;
      this.warn(phone, error, 'Conversa não existe mais no Chatwoot; abrindo outra');
      await this.forgetDesk(phone);
      return run();
    }
  }

  private async forgetIfGone(phone: string, error: unknown): Promise<void> {
    if (!isGone(error)) return;
    await this.forgetDesk(phone).catch(() => undefined);
  }

  private async forgetDesk(phone: string): Promise<void> {
    await this.repo.clearState(phone);
    await this.repo.clearThread(phone);
    await this.repo.clearContact(phone);
  }

  private warn(phone: string, error: unknown, message: string): void {
    this.logger.warn(
      { component: 'handoff', from: maskPhone(phone), error: errorKind(error) },
      message,
    );
  }
}
