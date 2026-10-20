import { env } from '../src/config/env';
import { HttpRevgasClient } from '../src/lib/revgas/http/http-revgas.client';
import { RevgasHttp } from '../src/lib/revgas/http/revgas-http';
import { resolveRevgasConfig } from '../src/lib/revgas/revgas.config';
import { RevgasForbiddenError } from '../src/lib/revgas/revgas.errors';

const DEFAULT_ESTABLISHMENT_ID = 2580;

describe.skipIf(!env.REVGAS_API_KEY)('RevGás API real (somente leitura)', () => {
  const config = resolveRevgasConfig({
    ...env,
    REVGAS_MODE: 'live',
    REVGAS_ESTABLISHMENT_ID: env.REVGAS_ESTABLISHMENT_ID ?? DEFAULT_ESTABLISHMENT_ID,
  });
  const silent = { info: () => undefined, warn: () => undefined };
  const http = new RevgasHttp({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey as string,
    timeoutMs: config.timeoutMs,
    minIntervalMs: config.minIntervalMs,
    logger: silent,
  });
  const client = new HttpRevgasClient(http, config.establishmentId as number);

  it('lista estabelecimentos incluindo o configurado', async () => {
    const page = await client.listEstablishments();
    expect(page.data.map(item => item.id)).toContain(config.establishmentId);
  });

  it('lista produtos', async () => {
    const page = await client.listProducts();
    expect(page.data.length).toBeGreaterThan(0);
  });

  it('lista negociações com forma de pagamento', async () => {
    const page = await client.listDeals({ page_size: 100 });
    expect(page.data.length).toBeGreaterThan(0);
    for (const deal of page.data) {
      expect(deal.payment_type).toBeDefined();
    }
  });

  it('lista vendas', async () => {
    const page = await client.listSales({ page_size: 5 });
    expect(Array.isArray(page.data)).toBe(true);
  });

  it('clientes exigem permissão que a chave atual não tem', async () => {
    await expect(client.findCustomersByPhone('11999999999')).rejects.toBeInstanceOf(
      RevgasForbiddenError,
    );
  });

  it('formas de pagamento exigem permissão que a chave atual não tem', async () => {
    await expect(client.listPaymentTypes()).rejects.toBeInstanceOf(RevgasForbiddenError);
  });
});
