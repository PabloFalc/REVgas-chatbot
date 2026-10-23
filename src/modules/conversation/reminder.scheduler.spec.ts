import type { PinoLogger } from 'nestjs-pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationRepository } from './conversation.repository';
import type { OrderState } from './flow/flow.types';
import { createFakeTools, FAKE_NOW } from './flow/testing/fake-tools';
import type { FlowToolsService } from './flow-tools';
import type { MessagingGateway } from './messaging.gateway';
import { ReminderScheduler } from './reminder.scheduler';

const PHONE = '5586999991234';
const OTHER = '5586999995678';

function idleState(): OrderState {
  return {
    step: 'choosePayment',
    customer: { id: 1, name: 'Maria' },
    lastInboundAt: new Date(FAKE_NOW.getTime() - 11 * 60_000).toISOString(),
  };
}

function setup(phones = [PHONE]) {
  const repository = {
    dueReminders: vi.fn(async () => phones.map((phone, index) => ({ phone, at: 1000 + index }))),
    claimReminder: vi.fn(async () => true),
    tryPhoneLock: vi.fn(async (_phone: string, work: () => Promise<unknown>) => ({
      ran: true as const,
      value: await work(),
    })),
    loadOrder: vi.fn(async () => idleState() as OrderState | null),
    saveOrder: vi.fn(async () => undefined),
    saveOrderKeepingTtl: vi.fn(async () => undefined),
  };
  const messaging = { send: vi.fn(async (_to: string, _reply: unknown) => undefined) };
  const flowTools = { forPhone: vi.fn(() => createFakeTools()) };
  const logger = {
    setContext: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const scheduler = new ReminderScheduler(
    repository as unknown as ConversationRepository,
    messaging as unknown as MessagingGateway,
    flowTools as unknown as FlowToolsService,
    logger as unknown as PinoLogger,
  );
  return { scheduler, repository, messaging, flowTools, logger };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ReminderScheduler.tick', () => {
  it('envia e salva mantendo o TTL', async () => {
    const { scheduler, repository, messaging, flowTools, logger } = setup();

    await scheduler.tick();

    expect(repository.claimReminder).toHaveBeenCalledWith(PHONE, 1000);
    expect(repository.tryPhoneLock).toHaveBeenCalledWith(PHONE, expect.any(Function));
    expect(messaging.send).toHaveBeenCalledTimes(2);
    expect(messaging.send.mock.calls[0]).toEqual([
      PHONE,
      { type: 'text', text: 'Ainda está aí? Seu pedido fica guardado por mais 5 minutos.' },
    ]);
    expect(repository.saveOrderKeepingTtl).toHaveBeenCalledWith(
      PHONE,
      expect.objectContaining({ step: 'choosePayment', remindedFor: idleState().lastInboundAt }),
    );
    expect(repository.saveOrder).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { component: 'reminder', from: '*******1234', step: 'choosePayment' },
      'Lembrete enviado',
    );

    const [save] = flowTools.forPhone.mock.calls[0] as unknown as [
      (state: OrderState) => Promise<void>,
    ];
    await save({ step: 'choosePayment', customer: {} });
    expect(repository.saveOrderKeepingTtl).toHaveBeenLastCalledWith(PHONE, {
      step: 'choosePayment',
      customer: {},
    });
    expect(repository.saveOrder).not.toHaveBeenCalled();
  });

  it('claim falso não faz nada', async () => {
    const { scheduler, repository, messaging } = setup();
    repository.claimReminder.mockResolvedValueOnce(false);

    await scheduler.tick();

    expect(repository.tryPhoneLock).not.toHaveBeenCalled();
    expect(messaging.send).not.toHaveBeenCalled();
  });

  it('lock ocupado não envia', async () => {
    const { scheduler, repository, messaging, logger } = setup();
    repository.tryPhoneLock.mockResolvedValueOnce({ ran: false } as never);

    await scheduler.tick();

    expect(repository.loadOrder).not.toHaveBeenCalled();
    expect(messaging.send).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ from: '*******1234', reason: 'busy' }),
      'Lembrete ignorado',
    );
  });

  it('pedido expirado não envia', async () => {
    const { scheduler, repository, messaging, logger } = setup();
    repository.loadOrder.mockResolvedValueOnce(null);

    await scheduler.tick();

    expect(messaging.send).not.toHaveBeenCalled();
    expect(repository.saveOrderKeepingTtl).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'expired' }),
      'Lembrete ignorado',
    );
  });

  it('cliente respondeu depois: não envia', async () => {
    const { scheduler, repository, messaging, logger } = setup();
    repository.loadOrder.mockResolvedValueOnce({
      ...idleState(),
      lastInboundAt: FAKE_NOW.toISOString(),
    });

    await scheduler.tick();

    expect(messaging.send).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'answered' }),
      'Lembrete ignorado',
    );
  });

  it('em creatingSale não envia', async () => {
    const { scheduler, repository, messaging, logger } = setup();
    repository.loadOrder.mockResolvedValueOnce({ ...idleState(), step: 'creatingSale' });

    await scheduler.tick();

    expect(messaging.send).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'creatingSale' }),
      'Lembrete ignorado',
    );
  });

  it('erro num telefone não impede o próximo', async () => {
    const { scheduler, repository, messaging, logger } = setup([PHONE, OTHER]);
    messaging.send.mockRejectedValueOnce(new Error('rede'));

    await expect(scheduler.tick()).resolves.toBeUndefined();

    expect(repository.claimReminder).toHaveBeenCalledWith(OTHER, 1001);
    expect(messaging.send.mock.calls.some(([to]) => to === OTHER)).toBe(true);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0][0]).toMatchObject({ from: '*******1234' });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(PHONE);
  });

  it('não roda em paralelo consigo mesmo', async () => {
    const { scheduler, repository } = setup();

    await Promise.all([scheduler.tick(), scheduler.tick()]);

    expect(repository.dueReminders).toHaveBeenCalledOnce();
  });

  it('nunca loga o telefone cru', async () => {
    const { scheduler, logger } = setup();
    await scheduler.tick();
    const logged = JSON.stringify(Object.values(logger).map(fn => fn.mock.calls));
    expect(logged).not.toContain(PHONE);
  });
});

describe('ReminderScheduler intervalo', () => {
  it('não inicia o intervalo em NODE_ENV=test', () => {
    vi.useFakeTimers();
    const { scheduler, repository } = setup();

    scheduler.onModuleInit();
    vi.advanceTimersByTime(60_000);

    expect(vi.getTimerCount()).toBe(0);
    expect(repository.dueReminders).not.toHaveBeenCalled();
    scheduler.onModuleDestroy();
  });
});
