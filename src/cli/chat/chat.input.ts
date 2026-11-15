import type { MenuOption } from './chat.render';

export type ChatCommand = 'sair' | 'novo' | 'ajuda';

export type MessageInput = { kind: 'text'; text: string } | { kind: 'choice'; option: MenuOption };

export type ChatInput =
  | MessageInput
  | { kind: 'empty' }
  | { kind: 'command'; command: ChatCommand }
  | { kind: 'unknown'; command: string };

const COMMANDS: readonly ChatCommand[] = ['sair', 'novo', 'ajuda'];
const FORCE_TEXT = '/texto';

export const CHAT_COMMANDS_HELP = [
  'Comandos:',
  '  <número>        escolhe o botão ou item da última mensagem do bot',
  '  /texto <msg>    manda <msg> como texto, mesmo que seja um número do menu',
  '  /novo           apaga o pedido e o lembrete deste telefone e recomeça',
  '  /ajuda          mostra estes comandos',
  '  /sair           encerra o simulador (Ctrl+C também)',
].join('\n');

export function parseLine(line: string, options: readonly MenuOption[] | null): ChatInput {
  const text = line.trim();
  if (!text) return { kind: 'empty' };

  if (text.startsWith('/')) {
    const [word] = text.split(/\s+/, 1);
    const name = word.toLowerCase();
    if (name === FORCE_TEXT) {
      const rest = text.slice(word.length).trim();
      return rest ? { kind: 'text', text: rest } : { kind: 'empty' };
    }
    const command = COMMANDS.find(candidate => `/${candidate}` === name);
    return command ? { kind: 'command', command } : { kind: 'unknown', command: word };
  }

  if (options && /^\d+$/.test(text)) {
    const option = options[Number(text) - 1];
    if (option) return { kind: 'choice', option };
  }
  return { kind: 'text', text };
}

export interface InboundParams {
  phone: string;
  name: string;
  phoneNumberId: string;
  messageId: string;
  input: MessageInput;
  timestamp?: number;
}

function messageContent(input: MessageInput): Record<string, unknown> {
  if (input.kind === 'text') return { type: 'text', text: { body: input.text } };
  const reply = { id: input.option.id, title: input.option.title };
  return input.option.kind === 'button'
    ? { type: 'interactive', interactive: { type: 'button_reply', button_reply: reply } }
    : { type: 'interactive', interactive: { type: 'list_reply', list_reply: reply } };
}

export function inboundPayload(params: InboundParams) {
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'SIMULATOR',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: params.phoneNumberId,
                phone_number_id: params.phoneNumberId,
              },
              contacts: [{ profile: { name: params.name }, wa_id: params.phone }],
              messages: [
                {
                  from: params.phone,
                  id: params.messageId,
                  timestamp: String(timestamp),
                  ...messageContent(params.input),
                },
              ] as unknown[],
            },
          },
        ],
      },
    ],
  };
}
