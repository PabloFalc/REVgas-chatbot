import { FakeRevgasClient } from './fake/fake-revgas.client';
import { HttpRevgasClient } from './http/http-revgas.client';
import { RevgasHttp, type RevgasLogger } from './http/revgas-http';
import { HybridRevgasClient } from './hybrid-revgas.client';
import type { RevgasClient } from './revgas.client';
import type { RevgasConfig } from './revgas.config';

export type CreateRevgasClientDeps = {
  logger?: RevgasLogger;
  fetch?: typeof fetch;
  nodeEnv?: string;
};

const noopLogger: RevgasLogger = { info: () => undefined, warn: () => undefined };

export function createRevgasClient(
  config: RevgasConfig,
  deps: CreateRevgasClientDeps = {},
): RevgasClient {
  const logger = deps.logger ?? noopLogger;

  if (deps.nodeEnv === 'production' && config.mode !== 'live') {
    logger.warn(
      { mode: config.mode },
      `Cliente RevGás rodando simulado em produção (REVGAS_MODE=${config.mode})`,
    );
  }

  if (config.mode === 'fake') {
    return new FakeRevgasClient();
  }

  const http = new RevgasHttp({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey as string,
    timeoutMs: config.timeoutMs,
    minIntervalMs: config.minIntervalMs,
    logger,
    fetch: deps.fetch,
  });
  const live = new HttpRevgasClient(http, config.establishmentId as number);

  if (config.mode === 'live') {
    return live;
  }

  return new HybridRevgasClient(
    live,
    new FakeRevgasClient({ dealsSource: () => live.listAllDeals() }),
  );
}
