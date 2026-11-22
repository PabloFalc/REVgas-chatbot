export type SimulatorRevgasMode = 'fake' | 'hybrid';

export interface ChatArgs {
  phone: string;
  name: string;
  revgas: SimulatorRevgasMode;
  logFile: string;
  help: boolean;
}

export const DEFAULT_CHAT_ARGS: ChatArgs = {
  phone: '5586999990000',
  name: 'Cliente Simulador',
  revgas: 'fake',
  logFile: 'logs/chat.log',
  help: false,
};

export const SIMULATOR_PHONE_NUMBER_ID = '100000000000000';

export const CHAT_USAGE = [
  'Uso: pnpm chat [opções]',
  '',
  '  --phone <número>    telefone do cliente simulado, só dígitos com DDI (padrão 5586999990000)',
  '  --name <nome>       nome do perfil do WhatsApp (padrão "Cliente Simulador")',
  '  --revgas <modo>     fake (padrão, nenhuma venda real) ou hybrid (leituras reais do ERP)',
  '  --log-file <arq>    arquivo dos logs do app (padrão logs/chat.log)',
  '  -h, --help          mostra esta ajuda',
].join('\n');

export class ChatArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatArgsError';
  }
}

const PHONE = /^\d{8,15}$/;
const REVGAS_MODES: readonly SimulatorRevgasMode[] = ['fake', 'hybrid'];
const VALUE_OPTIONS = new Set(['--phone', '--name', '--revgas', '--log-file']);

function splitOption(arg: string): [string, string | undefined] {
  const eq = arg.indexOf('=');
  return eq === -1 ? [arg, undefined] : [arg.slice(0, eq), arg.slice(eq + 1)];
}

function apply(args: ChatArgs, option: string, raw: string): void {
  const value = raw.trim();
  switch (option) {
    case '--phone':
      if (!PHONE.test(value)) {
        throw new ChatArgsError('--phone: telefone em formato wa_id (só dígitos, com DDI)');
      }
      args.phone = value;
      return;
    case '--name':
      if (!value) throw new ChatArgsError('--name: o nome não pode ser vazio');
      args.name = value;
      return;
    case '--revgas':
      if (!REVGAS_MODES.includes(value as SimulatorRevgasMode)) {
        throw new ChatArgsError('--revgas: use fake ou hybrid');
      }
      args.revgas = value as SimulatorRevgasMode;
      return;
    case '--log-file':
      if (!value) throw new ChatArgsError('--log-file: informe um caminho');
      args.logFile = value;
      return;
  }
}

export function parseChatArgs(argv: string[]): ChatArgs {
  const args: ChatArgs = { ...DEFAULT_CHAT_ARGS };
  for (let index = 0; index < argv.length; index += 1) {
    const [option, inline] = splitOption(argv[index]);
    if (option === '--help' || option === '-h') {
      args.help = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(option)) {
      throw new ChatArgsError(`Opção desconhecida: ${option}`);
    }
    const value = inline ?? argv[index + 1];
    if (inline === undefined) index += 1;
    if (value === undefined || (inline === undefined && value.startsWith('--'))) {
      throw new ChatArgsError(`${option}: falta o valor`);
    }
    apply(args, option, value);
  }
  return args;
}

export function simulatorEnv(args: ChatArgs): Record<string, string> {
  return {
    WHATSAPP_MODE: 'fake',
    WHATSAPP_ACCESS_TOKEN: '',
    WHATSAPP_APP_SECRET: '',
    WHATSAPP_VERIFY_TOKEN: '',
    WHATSAPP_PHONE_NUMBER_ID: SIMULATOR_PHONE_NUMBER_ID,
    REVGAS_MODE: args.revgas,
    LOG_FILE: args.logFile,
  };
}

export function assertSimulatorAllowed(nodeEnv: string | undefined): void {
  if (nodeEnv === 'production') {
    throw new Error('O simulador de chat não roda em produção (NODE_ENV=production).');
  }
}
