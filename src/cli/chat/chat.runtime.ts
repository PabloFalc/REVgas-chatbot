import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { clearLine, createInterface, cursorTo } from 'node:readline';
import { env } from '../../config/env';
import { closeDatabasePool } from '../../infra/database/drizzle-client';
import { resolveChatwootConfig } from '../../integrations/chatwoot/shared/chatwoot.config';
import { FakeWhatsappClient } from '../../integrations/whatsapp/fake-whatsapp.client';
import {
  WHATSAPP_WEBHOOK,
  type WhatsappWebhook,
} from '../../integrations/whatsapp/webhook/whatsapp-webhook';
import { WHATSAPP_CLIENT } from '../../integrations/whatsapp/whatsapp.client';
import { ConversationRepository } from '../../modules/conversation/conversation.repository';
import { ConversationService } from '../../modules/conversation/conversation.service';
import { createServer } from '../../server';
import { type ChatArgs, SIMULATOR_PHONE_NUMBER_ID } from './chat.args';
import { ChatSession } from './chat.session';

const POLL_INTERVAL_MS = 250;
const PROMPT = 'você › ';

export async function runChat(args: ChatArgs): Promise<void> {
  const app = await createServer();
  await app.listen(env.PORT, env.HOST);

  const client = app.get(WHATSAPP_CLIENT);
  if (!(client instanceof FakeWhatsappClient)) {
    await app.close();
    throw new Error('O WhatsApp não subiu em modo fake; o simulador não continua.');
  }
  const webhook = app.get<WhatsappWebhook>(WHATSAPP_WEBHOOK);
  const conversation = app.get(ConversationService);
  const conversations = app.get(ConversationRepository);

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: PROMPT });
  const tty = process.stdout.isTTY === true;
  let busy = true;
  let closed = false;
  rl.on('close', () => {
    closed = true;
  });
  rl.on('SIGINT', () => rl.close());

  const showPrompt = (keepTyped = false) => {
    if (tty && !closed && !busy) rl.prompt(keepTyped);
  };

  const print = (text: string) => {
    if (tty) {
      clearLine(process.stdout, 0);
      cursorTo(process.stdout, 0);
    }
    process.stdout.write(`${text}\n`);
    showPrompt(true);
  };

  const session = new ChatSession({
    phone: args.phone,
    name: args.name,
    phoneNumberId: SIMULATOR_PHONE_NUMBER_ID,
    outbox: client.sent,
    deliver: payload => conversation.handle(webhook.parse(payload)),
    reset: async () => {
      await conversations.clearOrder(args.phone);
      await conversations.cancelReminder(args.phone);
    },
    print,
    nextMessageId: () => `wamid.chat.${randomUUID()}`,
  });

  print(
    [
      'Simulador de chat do bot (WhatsApp fake: nada vai para a Meta)',
      `  cliente: ${args.name} (${args.phone})`,
      `  RevGás: ${args.revgas} · Chatwoot: ${resolveChatwootConfig(env).mode}`,
      `  app em http://localhost:${env.PORT} · logs em ${resolve(process.cwd(), args.logFile)}`,
      'Digite como o cliente. /ajuda mostra os comandos, /sair encerra.',
      '',
    ].join('\n'),
  );

  const timer = setInterval(() => session.flush(), POLL_INTERVAL_MS);
  busy = false;
  showPrompt();

  try {
    for await (const line of rl) {
      busy = true;
      if (!tty) process.stdout.write(`${PROMPT}${line}\n`);
      const outcome = await session.handle(line);
      busy = false;
      if (outcome === 'exit') break;
      showPrompt();
    }
  } finally {
    clearInterval(timer);
    rl.close();
    process.stdout.write('\nEncerrando...\n');
    await app.close();
    await closeDatabasePool();
  }
}
