import {
  graphErrorDetails,
  mapWhatsappError,
  WhatsappResponseError,
  WhatsappUnknownOutcomeError,
} from '../../core/erros/whatsapp/whatsapp.errors';
import { isTimeoutError } from '../../utils/guards';
import { maskPhone } from '../../utils/mask';
import { parseJsonOrText } from '../../utils/parse-json';
import {
  buttonsPayload,
  listPayload,
  type MessagePayload,
  readPayload,
  textPayload,
} from './messages/messages.payload';
import {
  type ButtonsMessage,
  type ListMessage,
  type SentMessage,
  sendResponseSchema,
  type TextMessage,
} from './messages/messages.schemas';
import type { WhatsappClient } from './whatsapp.client';

export type WhatsappLogger = {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
};

export type CloudApiOptions = {
  baseUrl: string;
  apiVersion: string;
  phoneNumberId: string;
  accessToken: string;
  timeoutMs: number;
  logger: WhatsappLogger;
  fetch?: typeof fetch;
  now?: () => number;
};

type Outcome =
  | { kind: 'response'; ok: boolean; status: number; body: unknown }
  | { kind: 'failure'; timedOut: boolean };

export class CloudApiWhatsappClient implements WhatsappClient {
  private readonly url: string;
  private readonly accessToken: string;
  private readonly timeoutMs: number;
  private readonly logger: WhatsappLogger;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(options: CloudApiOptions) {
    const base = options.baseUrl.replace(/\/+$/, '');
    this.url = `${base}/${options.apiVersion}/${options.phoneNumberId}/messages`;
    this.accessToken = options.accessToken;
    this.timeoutMs = options.timeoutMs;
    this.logger = options.logger;
    this.fetchFn = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async sendText(message: TextMessage): Promise<SentMessage> {
    return await this.send(textPayload(message));
  }

  async sendButtons(message: ButtonsMessage): Promise<SentMessage> {
    return await this.send(buttonsPayload(message));
  }

  async sendList(message: ListMessage): Promise<SentMessage> {
    return await this.send(listPayload(message));
  }

  async markAsRead(messageId: string): Promise<void> {
    const outcome = await this.post(readPayload(messageId), { op: 'read' });
    if (outcome.kind === 'failure') {
      throw new WhatsappUnknownOutcomeError('Falha de rede ao marcar mensagem como lida');
    }
    if (!outcome.ok) {
      throw mapWhatsappError(outcome.status, outcome.body);
    }
  }

  private async send(payload: MessagePayload): Promise<SentMessage> {
    const outcome = await this.post(payload.body, {
      op: 'send',
      type: payload.type,
      to: maskPhone(payload.to),
    });

    if (outcome.kind === 'failure') {
      throw new WhatsappUnknownOutcomeError(
        outcome.timedOut
          ? 'Envio ao WhatsApp expirou; não se sabe se a mensagem saiu'
          : 'Falha de rede no envio ao WhatsApp; não se sabe se a mensagem saiu',
      );
    }
    if (!outcome.ok) {
      throw mapWhatsappError(outcome.status, outcome.body);
    }

    const parsed = sendResponseSchema.safeParse(outcome.body);
    if (!parsed.success) {
      throw new WhatsappResponseError('Resposta do WhatsApp fora do formato esperado', 200);
    }
    return { id: parsed.data.messages[0].id };
  }

  private async post(body: Record<string, unknown>, logBase: Record<string, unknown>) {
    const startedAt = this.now();
    const base = { component: 'whatsapp', ...logBase };
    let outcome: Outcome;

    try {
      const response = await this.fetchFn(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const parsed = parseJsonOrText(await response.text());
      outcome = { kind: 'response', ok: response.ok, status: response.status, body: parsed };
    } catch (error) {
      const timedOut = isTimeoutError(error);
      outcome = { kind: 'failure', timedOut };
    }

    const durationMs = this.now() - startedAt;
    if (outcome.kind === 'failure') {
      this.logger.warn(
        { ...base, durationMs, error: outcome.timedOut ? 'timeout' : 'network' },
        'whatsapp request failed',
      );
    } else if (outcome.ok) {
      this.logger.info({ ...base, status: outcome.status, durationMs }, 'whatsapp request');
    } else {
      const { code } = graphErrorDetails(outcome.body);
      this.logger.warn(
        { ...base, status: outcome.status, code, durationMs },
        'whatsapp request failed',
      );
    }
    return outcome;
  }
}
