import type { ApiDocParams } from 'src/core/decorators/api-doc/api-doc.decorator';
import { httpReplySchema } from 'src/core/filters/http/http.schema';
import { webhookAckSchema } from './webhook.doc';

export const receiveDeskWebhookDocument: ApiDocParams = {
  summary: 'Eventos do Chatwoot',
  description:
    'Recebe mensagens do atendente e conversas resolvidas da caixa do Chatwoot. Exige X-Chatwoot-Signature (HMAC-SHA256 de "timestamp.corpo" com CHATWOOT_WEBHOOK_SECRET) e X-Chatwoot-Timestamp com até 300 s de diferença; sem segredo configurado, assinatura inválida ou timestamp velho → 401. Corpo que não é um evento → 400. Com assinatura válida responde 200 na hora e processa em segundo plano (falhas vão para o log).',
  statusCode: 200,
  response: {
    200: webhookAckSchema,
    400: httpReplySchema,
    401: httpReplySchema,
  },
};
