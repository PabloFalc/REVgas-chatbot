import underPressure from '@fastify/under-pressure';
import { ServiceUnavailableError } from 'src/core/erros/http.errors';
import { env } from '../env';
import type { AppSetup } from '../setup';

const RETRY_AFTER_SECONDS = 10;

export const pressure: AppSetup = async app => {
  if (env.NODE_ENV === 'test') return;

  const fastify = app.getHttpAdapter().getInstance();

  await fastify.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxEventLoopUtilization: 0.98,
    maxHeapUsedBytes: env.PRESSURE_MAX_HEAP_BYTES,
    maxRssBytes: env.PRESSURE_MAX_RSS_BYTES,
    pressureHandler: (_request, reply, type, value) => {
      reply.header('Retry-After', RETRY_AFTER_SECONDS);
      throw new ServiceUnavailableError({
        message: `Servidor sobrecarregado: ${type}`,
        details: { type, value },
      });
    },
  });
};
