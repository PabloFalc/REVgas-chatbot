import type { ApiDocParams } from 'src/core/decorators/api-doc/api-doc.decorator';
import { httpReplySchema } from 'src/core/filters/http/http.schema';
import { healthSchema } from '../schemas/health.schemas';

export const checkDocument: ApiDocParams = {
  summary: 'Health',
  statusCode: 200,
  description:
    'Rota de checagem da saúde da api; 200 OK = tudo ok;  200 DEGRADED = Redis ou memória falhou; 503 UNAVALIBLE = Banco de dados falou ou está indisponível. O detalhe por subsistema (checks) só é retornado fora de produção.',
  response: {
    200: healthSchema,
    503: httpReplySchema
      .extend({
        details: healthSchema,
      })
      .describe('Health Error'),
  },
};
