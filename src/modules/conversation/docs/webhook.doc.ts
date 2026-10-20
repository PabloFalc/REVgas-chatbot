import type { ApiDocParams } from 'src/core/decorators/api-doc/api-doc.decorator';
import { httpReplySchema } from 'src/core/filters/http/http.schema';
import { z } from 'zod';
import { VerificationQueryDto } from '../contracts/verification-query.dto';

export const webhookAckSchema = z.object({ received: z.literal(true) });

export const verifyWebhookDocument: ApiDocParams = {
  summary: 'Verificação do webhook (Meta)',
  description:
    'Chamado pela Meta ao configurar o webhook. Devolve hub.challenge em texto puro quando hub.verify_token confere com WHATSAPP_VERIFY_TOKEN; senão 403.',
  statusCode: 200,
  query: VerificationQueryDto,
  response: {
    200: z.string().describe('hub.challenge'),
    400: httpReplySchema,
    403: httpReplySchema,
  },
};

export const receiveWebhookDocument: ApiDocParams = {
  summary: 'Eventos do WhatsApp (Meta)',
  description:
    'Recebe mensagens e status da Cloud API. Exige X-Hub-Signature-256 (HMAC-SHA256 do corpo com WHATSAPP_APP_SECRET) quando o segredo está configurado; assinatura inválida → 401. Com assinatura válida responde 200 na hora e processa os eventos em segundo plano (falhas vão para o log), para a Meta não reenviar.',
  statusCode: 200,
  response: {
    200: webhookAckSchema,
    401: httpReplySchema,
  },
};
