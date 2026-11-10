import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/infra/cache/redis.service';
import type { DeskContact, DeskThread, HandoffState } from './contracts/handoff.types';

export const HANDOFF_PREFIX = 'handoff:state';
export const THREAD_PREFIX = 'handoff:thread';
export const CONTACT_PREFIX = 'handoff:contact';
export const DESK_EVENT_PREFIX = 'handoff:desk-event';

const STATE_TTL_SECONDS = 604_800;
const THREAD_TTL_SECONDS = 604_800;
const CONTACT_TTL_SECONDS = 2_592_000;
const DESK_EVENT_TTL_SECONDS = 86_400;

@Injectable()
export class HandoffRepository {
  constructor(private readonly cache: RedisService) {}

  getState(phone: string): Promise<HandoffState | null> {
    return this.cache.get<HandoffState>({ prefix: HANDOFF_PREFIX, key: phone });
  }

  saveState(phone: string, state: HandoffState): Promise<void> {
    return this.cache.set({
      prefix: HANDOFF_PREFIX,
      key: phone,
      value: state,
      ttl: STATE_TTL_SECONDS,
    });
  }

  clearState(phone: string): Promise<void> {
    return this.cache.delete({ prefix: HANDOFF_PREFIX, key: phone });
  }

  getThread(phone: string): Promise<DeskThread | null> {
    return this.cache.get<DeskThread>({ prefix: THREAD_PREFIX, key: phone });
  }

  saveThread(phone: string, thread: DeskThread): Promise<void> {
    return this.cache.set({
      prefix: THREAD_PREFIX,
      key: phone,
      value: thread,
      ttl: THREAD_TTL_SECONDS,
    });
  }

  clearThread(phone: string): Promise<void> {
    return this.cache.delete({ prefix: THREAD_PREFIX, key: phone });
  }

  getContact(phone: string): Promise<DeskContact | null> {
    return this.cache.get<DeskContact>({ prefix: CONTACT_PREFIX, key: phone });
  }

  saveContact(phone: string, contact: DeskContact): Promise<void> {
    return this.cache.set({
      prefix: CONTACT_PREFIX,
      key: phone,
      value: contact,
      ttl: CONTACT_TTL_SECONDS,
    });
  }

  async claimDeskMessage(messageId: number): Promise<boolean> {
    try {
      return await this.cache.setIfAbsent({
        prefix: DESK_EVENT_PREFIX,
        key: String(messageId),
        value: 1,
        ttl: DESK_EVENT_TTL_SECONDS,
      });
    } catch {
      return true;
    }
  }
}
