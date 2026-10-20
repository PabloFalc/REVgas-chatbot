import type { PinoLogger } from 'nestjs-pino';
import { WhatsappRejectedError } from 'src/core/erros/whatsapp/whatsapp.errors';
import { FakeWhatsappClient } from 'src/integrations/whatsapp/fake-whatsapp.client';
import { textWebhook, webhookPayload } from 'src/integrations/whatsapp/testing/webhook.testing';
import { parseWebhook } from 'src/integrations/whatsapp/webhook/webhook.parser';
import { describe, expect, it, vi } from 'vitest';
import type { IncomingContent } from './contracts/conversation.types';
import type { ConversationRepository } from './conversation.repository';
import { ConversationService, replyTo } from './conversation.service';
import { MessagingGateway } from './messaging.gateway';

function setup(whatsapp = new FakeWhatsappClient()) {
  const claimed = new Set<string>();
  const repository = {
    claimMessage: vi.fn(async (id: string) => {
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    }),
  };
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
    logger as unknown as PinoLogger,
  );
  return { service, repository, whatsapp, logger };
}

const message = (content: IncomingContent, name?: string) => ({
  id: 'wamid.1',
  from: '5586999991234',
  name,
  content,
});

describe('replyTo (resposta de teste, função pura)', () => {
  it('ecoa o texto e cumprimenta pelo primeiro nome', () => {
    const [reply] = replyTo(message({ type: 'text', text: 'oi' }, 'Maria da Silva'));
    expect(reply.type).toBe('text');
    expect(reply.type === 'text' && reply.text).toMatch(/^Olá, Maria! Recebi: "oi"/);
  });

  it('corta eco longo', () => {
    const [reply] = replyTo(message({ type: 'text', text: 'a'.repeat(500) }));
    expect(reply.type === 'text' && reply.text.length).toBeLessThan(400);
  });

  it('"lista" devolve lista interativa e "botões" devolve botões', () => {
    expect(replyTo(message({ type: 'text', text: 'Lista' }))[0].type).toBe('list');
    expect(replyTo(message({ type: 'text', text: 'botões' }))[0].type).toBe('buttons');
  });

  it('confirma a opção escolhida', () => {
    const [reply] = replyTo(message({ type: 'choice', id: 'demo:p13', title: 'Botijão P13' }));
    expect(reply.type === 'text' && reply.text).toContain('*Botijão P13*');
  });

  it('avisa quando o tipo de mensagem não é suportado', () => {
    const [reply] = replyTo(message({ type: 'unsupported' }));
    expect(reply.type === 'text' && reply.text).toContain('só entendo mensagens de texto');
  });
});

describe('ConversationService.handle', () => {
  it('marca como lida e responde para quem mandou', async () => {
    const { service, whatsapp } = setup();

    await service.handle(parseWebhook(textWebhook('lista', 'wamid.A')));

    expect(whatsapp.read).toEqual(['wamid.A']);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]).toMatchObject({ type: 'list', to: '5586999991234' });
  });

  it('não responde duas vezes a mesma mensagem reenviada pela Meta', async () => {
    const { service, whatsapp } = setup();
    const events = parseWebhook(textWebhook('oi', 'wamid.B'));

    await service.handle(events);
    await service.handle(events);

    expect(whatsapp.sent).toHaveLength(1);
  });

  it('as respostas de demonstração cabem nos limites do WhatsApp', async () => {
    const { service, whatsapp, logger } = setup();

    await service.handle(parseWebhook(textWebhook('lista', 'wamid.L')));
    await service.handle(parseWebhook(textWebhook('botoes', 'wamid.K')));

    expect(logger.error).not.toHaveBeenCalled();
    expect(whatsapp.sent.map(sent => sent.type)).toEqual(['list', 'buttons']);
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

  it('nunca loga o telefone cru', async () => {
    const { service, logger } = setup();
    await service.handle(parseWebhook(textWebhook('oi', 'wamid.F')));
    const logged = JSON.stringify(Object.values(logger).map(fn => fn.mock.calls));
    expect(logged).not.toContain('5586999991234');
  });
});
