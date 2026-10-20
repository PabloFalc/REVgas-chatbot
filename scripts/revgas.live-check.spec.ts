import { beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { createHttpRevgasClient } from '../src/integrations/revgas/http-revgas.client';
import type { RevgasClient } from '../src/integrations/revgas/revgas.client';
import {
  type RevgasConfig,
  resolveRevgasConfig,
} from '../src/integrations/revgas/shared/revgas.config';
import { RevgasForbiddenError } from '../src/integrations/revgas/shared/revgas.errors';
import { RevgasHttp } from '../src/integrations/revgas/shared/revgas-http';

const DEFAULT_ESTABLISHMENT_ID = 2580;

describe.skipIf(!env.REVGAS_API_KEY)('RevGás API real (somente leitura)', () => {
  let config: RevgasConfig;
  let revgas: RevgasClient;

  beforeAll(() => {
    config = resolveRevgasConfig({
      ...env,
      REVGAS_MODE: 'live',
      REVGAS_ESTABLISHMENT_ID: env.REVGAS_ESTABLISHMENT_ID ?? DEFAULT_ESTABLISHMENT_ID,
    });
    const http = new RevgasHttp({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey ?? '',
      timeoutMs: config.timeoutMs,
      minIntervalMs: config.minIntervalMs,
      logger: { info: () => undefined, warn: () => undefined },
    });
    revgas = createHttpRevgasClient(http, config.establishmentId ?? DEFAULT_ESTABLISHMENT_ID);
  });

  it('lista estabelecimentos incluindo o configurado', async () => {
    const page = await revgas.establishments.list();
    expect(page.data.map(item => item.id)).toContain(config.establishmentId);
  });

  it('lista produtos', async () => {
    const page = await revgas.products.list();
    expect(page.data.length).toBeGreaterThan(0);
  });

  it('lista negociações com forma de pagamento', async () => {
    const page = await revgas.deals.list({ page_size: 100 });
    expect(page.data.length).toBeGreaterThan(0);
    for (const deal of page.data) {
      expect(deal.payment_type).toBeDefined();
    }
    expect(page.data.some(deal => typeof deal.payment_type_establishment_id === 'number')).toBe(
      true,
    );
  });

  it('lista vendas', async () => {
    const page = await revgas.sales.list({ page_size: 5 });
    expect(Array.isArray(page.data)).toBe(true);
  });

  it('clientes exigem permissão que a chave atual não tem', async () => {
    await expect(revgas.customers.findByPhone('11999999999')).rejects.toBeInstanceOf(
      RevgasForbiddenError,
    );
  });

  it('formas de pagamento exigem permissão que a chave atual não tem', async () => {
    await expect(revgas.paymentTypes.list()).rejects.toBeInstanceOf(RevgasForbiddenError);
  });
});
