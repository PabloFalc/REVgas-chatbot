import type { PinoLogger } from 'nestjs-pino';
import { WhatsappRejectedError } from 'src/core/erros/whatsapp/whatsapp.errors';
import { FakeWhatsappClient } from 'src/integrations/whatsapp/fake-whatsapp.client';
import { textWebhook, webhookPayload } from 'src/integrations/whatsapp/testing/webhook.testing';
import { parseWebhook } from 'src/integrations/whatsapp/webhook/webhook.parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationRepository } from './conversation.repository';
import { ConversationService } from './conversation.service';
import { runFlow } from './flow/flow';
import { type OrderState, ToolError } from './flow/flow.types';
import { text } from './flow/replies';
import { createFakeTools } from './flow/testing/fake-tools';
import type { FlowToolsService } from './flow-tools';
import { MessagingGateway } from './messaging.gateway';

vi.mock('./flow/flow', () => ({ runFlow: vi.fn() }));

const runFlowMock = vi.mocked(runFlow);

beforeEach(() => {
  runFlowMock.mockReset();
  runFlowMock.mockResolvedValue({
    state: { step: 'askName', customer: {} },
    replies: [text('olá')],
  });
});

function setup(whatsapp = new FakeWhatsappClient()) {
  const claimed = new Set<string>();
  const repository = {
    claimMessage: vi.fn(async (id: string) => {
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    }),
    loadOrder: vi.fn(async () => null as OrderState | null),
    saveOrder: vi.fn(async () => undefined),
    clearOrder: vi.fn(async () => undefined),
    scheduleReminder: vi.fn(async () => undefined),
    cancelReminder: vi.fn(async () => undefined),
    withPhoneLock: vi.fn(async (_phone: string, work: () => Promise<unknown>) => work()),
  };
  const flowTools = { forPhone: vi.fn(() => createFakeTools()) };
  const logger = {
    setContext: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const service = new ConversationService(
    repository as unknown as ConversationRepository,
    new MessagingGateway(whatsapp),
    flowTools as unknown as FlowToolsService,
    logger as unknown as PinoLogger,
  );
  return { service, repository, flowTools, whatsapp, logger };
}

describe('ConversationService.handle', () => {
  it('marca como lida e responde para quem mandou', async () => {
    const { service, whatsapp } = setup();

    await service.handle(parseWebhook(textWebhook('oi', 'wamid.A')));

    expect(whatsapp.read).toEqual(['wamid.A']);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]).toMatchObject({ type: 'text', to: '5586999991234' });
  });

  it('roda o fluxo com o estado carregado, grava o novo e responde na ordem', async () => {
    const { service, repository, whatsapp } = setup();
    const loaded: OrderState = { step: 'askCpf', customer: { name: 'Maria' } };
    const saved: OrderState = { step: 'chooseAddress', customer: { name: 'Maria' } };
    repository.loadOrder.mockResolvedValueOnce(loaded);
    runFlowMock.mockResolvedValueOnce({ state: saved, replies: [text('um'), text('dois')] });

    await service.handle(parseWebhook(textWebhook('123', 'wamid.S')));

    expect(runFlowMock).toHaveBeenCalledWith(
      loaded,
      { phone: '5586999991234', content: { type: 'text', text: '123' } },
      expect.anything(),
      expect.any(Function),
    );
    expect(repository.saveOrder).toHaveBeenCalledWith(
      '5586999991234',
      expect.objectContaining(saved),
    );
    expect(repository.clearOrder).not.toHaveBeenCalled();
    expect(whatsapp.sent).toHaveLength(2);
    expect(JSON.stringify(whatsapp.sent[0].body)).toContain('um');
    expect(JSON.stringify(whatsapp.sent[1].body)).toContain('dois');
  });

  it('estado nulo apaga o pedido em andamento', async () => {
    const { service, repository } = setup();
    runFlowMock.mockResolvedValueOnce({ state: null, replies: [text('cancelado')] });

    await service.handle(parseWebhook(textWebhook('cancelar', 'wamid.N')));

    expect(repository.clearOrder).toHaveBeenCalledWith('5586999991234');
    expect(repository.saveOrder).not.toHaveBeenCalled();
  });

  it('processa sob o lock do telefone e o checkpoint grava o pedido', async () => {
    const { service, repository, flowTools } = setup();

    await service.handle(parseWebhook(textWebhook('oi', 'wamid.LK')));

    expect(repository.withPhoneLock).toHaveBeenCalledWith('5586999991234', expect.any(Function));
    const [save] = flowTools.forPhone.mock.calls[0] as unknown as [
      (state: OrderState) => Promise<void>,
    ];
    await save({ step: 'askName', customer: {} });
    expect(repository.saveOrder).toHaveBeenCalledWith('5586999991234', {
      step: 'askName',
      customer: {},
    });
  });

  it('erro inesperado do fluxo é logado sem responder e sem texto do cliente', async () => {
    const { service, whatsapp, logger } = setup();
    runFlowMock.mockRejectedValueOnce(new Error('bug'));

    await service.handle(parseWebhook(textWebhook('meu cpf 12345678909', 'wamid.X')));

    expect(whatsapp.sent).toEqual([]);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('12345678909');
  });

  it('não responde duas vezes a mesma mensagem reenviada pela Meta', async () => {
    const { service, whatsapp } = setup();
    const events = parseWebhook(textWebhook('oi', 'wamid.B'));

    await service.handle(events);
    await service.handle(events);

    expect(whatsapp.sent).toHaveLength(1);
  });

  it('falha no envio é logada sem derrubar o processamento dos outros eventos', async () => {
    const whatsapp = new FakeWhatsappClient();
    const send = vi
      .spyOn(whatsapp, 'sendText')
      .mockRejectedValueOnce(new WhatsappRejectedError('fora da janela', 400, 131047));
    const { service, logger } = setup(whatsapp);

    await service.handle([
      ...parseWebhook(textWebhook('oi', 'wamid.C')),
      ...parseWebhook(textWebhook('oi', 'wamid.D')),
    ]);

    expect(send).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      from: '*******1234',
      error: { kind: 'rejected', code: 131047 },
    });
  });

  it('falha ao marcar como lida não impede a resposta', async () => {
    const whatsapp = new FakeWhatsappClient();
    vi.spyOn(whatsapp, 'markAsRead').mockRejectedValueOnce(new Error('rede'));
    const { service } = setup(whatsapp);

    await service.handle(parseWebhook(textWebhook('oi', 'wamid.E')));

    expect(whatsapp.sent).toHaveLength(1);
  });

  it('loga status de falha de entrega e não responde a status', async () => {
    const { service, whatsapp, logger } = setup();

    await service.handle(
      parseWebhook(
        webhookPayload({
          statuses: [
            {
              id: 'wamid.OUT',
              status: 'failed',
              recipient_id: '5586999991234',
              errors: [{ code: 131047 }],
            },
          ],
        }),
      ),
    );

    expect(whatsapp.sent).toEqual([]);
    expect(logger.warn.mock.calls[0][0]).toMatchObject({
      errorCodes: [131047],
      recipient: '*******1234',
    });
  });

  it('nunca rejeita: erro inesperado num evento é logado e os outros seguem', async () => {
    const { service, repository, whatsapp, logger } = setup();
    repository.claimMessage.mockRejectedValueOnce(new Error('bug'));

    await expect(
      service.handle([
        ...parseWebhook(textWebhook('oi', 'wamid.G')),
        ...parseWebhook(textWebhook('oi', 'wamid.H')),
      ]),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledOnce();
    expect(whatsapp.sent).toHaveLength(1);
  });

  it('falha de ferramenta é logada como aviso só com o nome da causa, sem mensagem nem telefone', async () => {
    const { service, logger } = setup();
    runFlowMock.mockImplementationOnce(async (_state, _input, _tools, onToolError) => {
      onToolError?.(new ToolError(new TypeError('cpf 12345678909 fora do ar')));
      return { state: null, replies: [text('indisponível')] };
    });

    await service.handle(parseWebhook(textWebhook('oi', 'wamid.G')));

    const call = logger.warn.mock.calls.find(
      ([, message]) => message === 'Falha em ferramenta do fluxo',
    );
    expect(call?.[0]).toMatchObject({
      component: 'conversation',
      messageId: 'wamid.G',
      from: expect.not.stringContaining('5586999991234'),
      cause: 'TypeError',
    });
    const logged = JSON.stringify(logger.warn.mock.calls);
    expect(logged).not.toContain('12345678909');
    expect(logged).not.toContain('fora do ar');
    expect(logged).not.toContain('5586999991234');
  });

  it('nunca loga o telefone cru', async () => {
    const { service, logger } = setup();
    await service.handle(parseWebhook(textWebhook('oi', 'wamid.F')));
    const logged = JSON.stringify(Object.values(logger).map(fn => fn.mock.calls));
    expect(logged).not.toContain('5586999991234');
  });
});

describe('ConversationService venda criada', () => {
  const saleResult = {
    state: null,
    replies: [text('Pedido nº 55 confirmado')],
    saleId: 55,
  };

  it('loga o id da venda antes de enviar as respostas', async () => {
    const { service, logger, whatsapp } = setup();
    const order: string[] = [];
    logger.info.mockImplementation((_obj: unknown, message?: string) => {
      if (message === 'Venda criada') order.push('log');
    });
    const send = whatsapp.sendText.bind(whatsapp);
    vi.spyOn(whatsapp, 'sendText').mockImplementation(async (...args) => {
      order.push('send');
      return send(...args);
    });
    runFlowMock.mockResolvedValueOnce(saleResult);

    await service.handle(parseWebhook(textWebhook('confirmar', 'wamid.V1')));

    expect(order).toEqual(['log', 'send']);
    expect(logger.info).toHaveBeenCalledWith(
      {
        component: 'conversation',
        phone: '*******1234',
        messageId: 'wamid.V1',
        saleId: 55,
      },
      'Venda criada',
    );
  });

  it('o id da venda já está no log quando o envio falha', async () => {
    const whatsapp = new FakeWhatsappClient();
    const { service, logger } = setup(whatsapp);
    vi.spyOn(whatsapp, 'sendText').mockRejectedValue(new Error('rede'));
    runFlowMock.mockResolvedValueOnce(saleResult);

    await service.handle(parseWebhook(textWebhook('confirmar', 'wamid.V2')));

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ saleId: 55 }),
      'Venda criada',
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it('não loga telefone cru nem venda quando não há saleId', async () => {
    const { service, logger } = setup();
    runFlowMock.mockResolvedValueOnce(saleResult);
    await service.handle(parseWebhook(textWebhook('confirmar', 'wamid.V3')));
    const created = logger.info.mock.calls.filter(call => call[1] === 'Venda criada');
    expect(JSON.stringify(created)).not.toContain('5586999991234');

    const other = setup();
    await other.service.handle(parseWebhook(textWebhook('oi', 'wamid.V4')));
    expect(other.logger.info.mock.calls.some(call => call[1] === 'Venda criada')).toBe(false);
  });
});

describe('ConversationService lembrete', () => {
  const now = new Date('2026-10-21T12:00:00-03:00');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('agenda o lembrete 10 min depois da mensagem', async () => {
    const { service, repository } = setup();
    const saved: OrderState = { step: 'chooseAddress', customer: { name: 'Maria' } };
    runFlowMock.mockResolvedValueOnce({ state: saved, replies: [text('um')] });

    await service.handle(parseWebhook(textWebhook('oi', 'wamid.R1')));

    expect(repository.saveOrder).toHaveBeenCalledWith('5586999991234', {
      ...saved,
      lastInboundAt: now.toISOString(),
    });
    expect(repository.scheduleReminder).toHaveBeenCalledWith(
      '5586999991234',
      new Date(now.getTime() + 600_000),
    );
    expect(repository.cancelReminder).not.toHaveBeenCalled();
  });

  it('pedido encerrado cancela o lembrete', async () => {
    const { service, repository } = setup();
    runFlowMock.mockResolvedValueOnce({ state: null, replies: [text('cancelado')] });

    await service.handle(parseWebhook(textWebhook('cancelar', 'wamid.R2')));

    expect(repository.clearOrder).toHaveBeenCalledWith('5586999991234');
    expect(repository.cancelReminder).toHaveBeenCalledWith('5586999991234');
    expect(repository.scheduleReminder).not.toHaveBeenCalled();
  });
});
