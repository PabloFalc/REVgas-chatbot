import 'reflect-metadata';
import {
  assertSimulatorAllowed,
  CHAT_USAGE,
  ChatArgsError,
  parseChatArgs,
  simulatorEnv,
} from './chat/chat.args';
import { formatCliError } from './kb-ingest.args';

async function main(): Promise<void> {
  const args = parseChatArgs(process.argv.slice(2));
  if (args.help) {
    console.log(CHAT_USAGE);
    return;
  }

  Object.assign(process.env, simulatorEnv(args));
  await import('dotenv/config');
  assertSimulatorAllowed(process.env.NODE_ENV);

  const { runChat } = await import('./chat/chat.runtime.js');
  await runChat(args);
}

main().catch((error: unknown) => {
  const message =
    error instanceof ChatArgsError ? `${error.message}\n\n${CHAT_USAGE}` : formatCliError(error);
  console.error(message);
  process.exitCode = 1;
});
