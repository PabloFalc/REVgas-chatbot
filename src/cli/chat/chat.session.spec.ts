import { beforeEach, describe, expect, it } from 'vitest';
import { FakeWhatsappClient } from '../../integrations/whatsapp/fake-whatsapp.client';
import { parseWebhook } from '../../integrations/whatsapp/webhook/webhook.parser';
import { CHAT_COMMANDS_HELP } from './chat.input';
import { ChatSession } from './chat.session';

const PHONE = '5586999990000';
const OTHER = '5586911112222';

describe('ChatSession', () => {
  let client: FakeWhatsappClient;
  let printed: string[];
  let delivered: unknown[];
  let resets: number;
  let botReply: (payload: unknown) => Promise<void>;
  let session: ChatSession;

  const create = () =>
    new ChatSession({
      phone: PHONE,
      name: 'Cliente Simulador',
      phoneNumberId: '100000000000000',
      outbox: client.sent,
      deliver: async payload => {
        delivered.push(payload);
        await botReply(payload);
      },
      reset: async () => {
        resets += 1;
      },
      print: line => printed.push(line),
      nextMessageId: () => `wamid.chat.${delivered.length + 1}`,
    });

  const contentOf = (index: number) => {
    const [event] = parseWebhook(delivered[index]);
    return event?.kind === 'message' ? event.content : undefined;
  };

  beforeEach(() => {
    client = new FakeWhatsappClient();
    printed = [];
    delivered = [];
    resets = 0;
    botReply = async () => undefined;
    session = create();
  });

  it('ignora o que já estava na caixa de saída antes de começar', async () => {
    await client.sendText({ to: PHONE, text: 'antigo' });
    session = create();
    session.flush();
    expect(printed).toEqual([]);
  });

  it('mostra só as mensagens para o telefone do cliente, uma vez cada', async () => {
    await client.sendText({ to: OTHER, text: 'para outro' });
    await client.sendText({ to: PHONE, text: 'Atendente: oi' });
    session.flush();
    session.flush();
    expect(printed).toEqual(['bot › Atendente: oi']);
  });

  it('manda o texto digitado e mostra as respostas do bot', async () => {
    botReply = async () => {
      await client.sendText({ to: PHONE, text: 'Olá! Qual o seu CEP?' });
    };
    expect(await session.handle('oi')).toBe('continue');
    expect(contentOf(0)).toEqual({ type: 'text', text: 'oi' });
    expect(printed).toEqual(['bot › Olá! Qual o seu CEP?']);
  });

  it('número escolhe o botão da última mensagem e mostra o que foi tocado', async () => {
    await client.sendButtons({
      to: PHONE,
      body: 'Confere?',
      buttons: [
        { id: 'confirm', title: 'Confirmar' },
        { id: 'fix', title: 'Corrigir' },
      ],
    });
    session.flush();
    printed = [];

    await session.handle('2');

    expect(contentOf(0)).toEqual({ type: 'reply', replyId: 'fix', title: 'Corrigir' });
    expect(printed).toEqual(['você → Corrigir']);
  });

  it('mensagem de texto posterior desfaz o menu anterior', async () => {
    await client.sendButtons({
      to: PHONE,
      body: 'Confere?',
      buttons: [{ id: 'ok', title: 'Sim' }],
    });
    await client.sendText({ to: PHONE, text: 'Quantos botijões?' });
    session.flush();

    await session.handle('1');

    expect(contentOf(0)).toEqual({ type: 'text', text: '1' });
  });

  it('cada mensagem enviada tem id próprio', async () => {
    await session.handle('oi');
    await session.handle('tudo bem?');
    const ids = delivered.map(payload => parseWebhook(payload)[0]?.id);
    expect(ids).toEqual(['wamid.chat.1', 'wamid.chat.2']);
  });

  it('/novo limpa o estado, desfaz o menu e avisa', async () => {
    await client.sendButtons({
      to: PHONE,
      body: 'Confere?',
      buttons: [{ id: 'ok', title: 'Sim' }],
    });
    session.flush();
    printed = [];

    expect(await session.handle('/novo')).toBe('continue');
    await session.handle('1');

    expect(resets).toBe(1);
    expect(printed[0]).toMatch(/Pedido e lembrete apagados/);
    expect(contentOf(0)).toEqual({ type: 'text', text: '1' });
  });

  it('/sair encerra sem enviar nada', async () => {
    expect(await session.handle('/sair')).toBe('exit');
    expect(delivered).toEqual([]);
  });

  it('/ajuda mostra os comandos e comando desconhecido é avisado', async () => {
    await session.handle('/ajuda');
    await session.handle('/voltar');
    expect(printed).toEqual([CHAT_COMMANDS_HELP, 'Comando desconhecido: /voltar (veja /ajuda)']);
    expect(delivered).toEqual([]);
  });

  it('linha vazia não envia nada', async () => {
    await session.handle('  ');
    expect(delivered).toEqual([]);
    expect(printed).toEqual([]);
  });

  it('falha ao entregar é mostrada e o simulador segue', async () => {
    botReply = async () => {
      throw new Error('Redis fora do ar');
    };
    expect(await session.handle('oi')).toBe('continue');
    expect(printed).toEqual(['[erro] Falha ao entregar a mensagem: Redis fora do ar']);
  });
});
