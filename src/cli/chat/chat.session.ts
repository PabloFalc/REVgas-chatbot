import { CHAT_COMMANDS_HELP, inboundPayload, type MessageInput, parseLine } from './chat.input';
import { type MenuOption, renderMessage } from './chat.render';

export interface OutboxMessage {
  to: string;
  body: Record<string, unknown>;
}

export interface ChatSessionDeps {
  phone: string;
  name: string;
  phoneNumberId: string;
  outbox: readonly OutboxMessage[];
  deliver(payload: unknown): Promise<void>;
  reset(): Promise<void>;
  print(text: string): void;
  nextMessageId(): string;
}

export type SessionOutcome = 'continue' | 'exit';

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ChatSession {
  private cursor: number;
  private options: MenuOption[] | null = null;

  constructor(private readonly deps: ChatSessionDeps) {
    this.cursor = deps.outbox.length;
  }

  flush(): void {
    const { outbox } = this.deps;
    if (outbox.length < this.cursor) this.cursor = 0;
    while (this.cursor < outbox.length) {
      const message = outbox[this.cursor];
      this.cursor += 1;
      if (message.to !== this.deps.phone) continue;
      const rendered = renderMessage(message.body);
      this.options = rendered.options;
      this.deps.print(rendered.lines.join('\n'));
    }
  }

  async handle(line: string): Promise<SessionOutcome> {
    const input = parseLine(line, this.options);
    switch (input.kind) {
      case 'empty':
        return 'continue';
      case 'unknown':
        this.deps.print(`Comando desconhecido: ${input.command} (veja /ajuda)`);
        return 'continue';
      case 'command':
        return await this.command(input.command);
      default:
        await this.send(input);
        return 'continue';
    }
  }

  private async command(command: 'sair' | 'novo' | 'ajuda'): Promise<SessionOutcome> {
    if (command === 'sair') return 'exit';
    if (command === 'ajuda') {
      this.deps.print(CHAT_COMMANDS_HELP);
      return 'continue';
    }
    try {
      await this.deps.reset();
      this.options = null;
      this.deps.print('Pedido e lembrete apagados. A próxima mensagem começa do zero.');
    } catch (error) {
      this.deps.print(`[erro] Falha ao apagar o pedido: ${failure(error)}`);
    }
    return 'continue';
  }

  private async send(input: MessageInput): Promise<void> {
    if (input.kind === 'choice') this.deps.print(`você → ${input.option.title}`);
    const payload = inboundPayload({
      phone: this.deps.phone,
      name: this.deps.name,
      phoneNumberId: this.deps.phoneNumberId,
      messageId: this.deps.nextMessageId(),
      input,
    });
    try {
      await this.deps.deliver(payload);
    } catch (error) {
      this.deps.print(`[erro] Falha ao entregar a mensagem: ${failure(error)}`);
    }
    this.flush();
  }
}
