import { FakeViacepClient } from './fake-viacep.client';
import { HttpViacepClient } from './http-viacep.client';
import type { ViacepConfig } from './shared/viacep.config';
import type { ViacepClient } from './viacep.client';

export type CreateViacepDeps = {
  fetch?: typeof fetch;
};

export function createViacepClient(
  config: ViacepConfig,
  deps: CreateViacepDeps = {},
): ViacepClient {
  if (config.mode === 'fake') {
    return new FakeViacepClient();
  }
  return new HttpViacepClient({
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    fetch: deps.fetch,
  });
}
