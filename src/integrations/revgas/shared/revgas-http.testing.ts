import { vi } from 'vitest';
import { RevgasHttp } from './revgas-http';

const silentLogger = { info: () => undefined, warn: () => undefined };

export const pagination = (over: Record<string, unknown> = {}) => ({
  page: 1,
  count: 1,
  total_count: 1,
  ...over,
});

export function setupHttp(responses: Array<{ body: unknown; status?: number }>) {
  const queue = [...responses];
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  });
  const http = new RevgasHttp({
    baseUrl: 'https://api.test/v1',
    apiKey: 'key',
    timeoutMs: 1000,
    minIntervalMs: 0,
    logger: silentLogger,
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  const call = (index = 0) => {
    const [url, init] = fetchMock.mock.calls[index];
    return {
      url: new URL(String(url)),
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
  };
  return { http, fetchMock, call };
}
