import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import { REDIS } from 'src/infra/cache/redis.client';
import { DRIZZLE } from 'src/infra/database/drizzle-client';
import { CHATWOOT_CLIENT } from 'src/integrations/chatwoot/chatwoot.client';
import { FakeChatwootClient } from 'src/integrations/chatwoot/fake-chatwoot.client';
import { BotEventsRepository } from 'src/modules/metrics/bot-events.repository';
import { describe, expect, it, vi } from 'vitest';
import type { HandoffState } from './contracts/handoff.types';
import { HandoffModule } from './handoff.module';
import { HandoffRepository } from './handoff.repository';
import { HandoffService } from './handoff.service';

const PHONE = '5585999990000';

describe('HandoffModule', () => {
  it('injeta o BotEventsRepository e registra handoff_assumed ao assumir', async () => {
    let state: HandoffState | null = {
      status: 'queued',
      reason: 'customer_request',
      since: '2026-11-09T10:00:00.000Z',
      requestedAt: '2026-11-09T10:00:00.000Z',
      handoffId: '0b6f6c1e-2d1c-4e53-9a43-5b1f1f3e7a10',
      conversationId: 20,
    } as HandoffState;
    const repo = {
      getState: vi.fn(async () => state),
      saveState: vi.fn(async (_phone: string, next: HandoffState) => {
        state = next;
      }),
      saveThread: vi.fn(async () => undefined),
    };
    const events = { record: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }), HandoffModule],
    })
      .overrideProvider(REDIS)
      .useValue({})
      .overrideProvider(DRIZZLE)
      .useValue({})
      .overrideProvider(CHATWOOT_CLIENT)
      .useValue(new FakeChatwootClient({ inboxId: 1 }))
      .overrideProvider(HandoffRepository)
      .useValue(repo)
      .overrideProvider(BotEventsRepository)
      .useValue(events)
      .compile();

    const result = await moduleRef.get(HandoffService).markAgentMessage(PHONE, 20);

    expect(result.becameActive).toBe(true);
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'handoff_assumed' }),
    );
  });
});
