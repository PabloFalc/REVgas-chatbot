import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { env } from '../src/config/env';
import { RevgasError } from '../src/core/erros/revgas/revgas.errors';
import type { RevgasCustomer } from '../src/integrations/revgas/customers/customers.schemas';
import { createHttpRevgasClient } from '../src/integrations/revgas/http-revgas.client';
import type { RevgasClient } from '../src/integrations/revgas/revgas.client';
import { resolveRevgasConfig } from '../src/integrations/revgas/shared/revgas.config';
import { RevgasHttp } from '../src/integrations/revgas/shared/revgas-http';
import { isValidCpf } from '../src/utils/cpf';

const DEFAULT_ESTABLISHMENT_ID = 2580;
const WRITES = process.env.REVGAS_LIVE_WRITES === 'true';
const anything = z.unknown();

type Probe = { status: number; keys: string[]; count: number | null; total: number | null };

function randomDigits(size: number): number[] {
  return Array.from({ length: size }, () => Math.floor(Math.random() * 10));
}

function cpfDigit(digits: number[]): number {
  const length = digits.length;
  const sum = digits.reduce((acc, digit, index) => acc + digit * (length + 1 - index), 0);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

function randomCpf(): string {
  for (;;) {
    const base = randomDigits(9);
    const first = cpfDigit(base);
    const second = cpfDigit([...base, first]);
    const cpf = [...base, first, second].join('');
    if (isValidCpf(cpf)) return cpf;
  }
}

function randomPhone(): string {
  return `55869${randomDigits(8).join('')}`;
}

function maskCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.***.***-${cpf.slice(9)}`;
}

type Setup = { http: RevgasHttp; revgas: RevgasClient; allowed: boolean };

async function setup(): Promise<Setup> {
  const config = resolveRevgasConfig({
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
  const revgas = createHttpRevgasClient(http, config.establishmentId ?? DEFAULT_ESTABLISHMENT_ID);
  const allowed = (await probe(http, { page_size: '1' })).status === 200;
  return { http, revgas, allowed };
}

async function probe(http: RevgasHttp, query: Record<string, string>): Promise<Probe> {
  try {
    const body = (await http.request({
      method: 'GET',
      path: '/customers',
      query,
      schema: anything,
    })) as { data?: unknown[]; pagination?: { total_count?: number } };
    return {
      status: 200,
      keys: Object.keys(body ?? {}),
      count: Array.isArray(body?.data) ? body.data.length : null,
      total: body?.pagination?.total_count ?? null,
    };
  } catch (error) {
    const status = error instanceof RevgasError ? (error.status ?? 0) : 0;
    return { status, keys: [], count: null, total: null };
  }
}

const pageOfIds = z.object({
  data: z.array(z.looseObject({ id: z.number() })),
  pagination: z.looseObject({ total_count: z.number() }),
});

function statusOf(error: unknown): number | null {
  return error instanceof RevgasError ? (error.status ?? null) : null;
}

describe.skipIf(!env.REVGAS_API_KEY)('RevGás API real: clientes (leitura)', () => {
  let ctx: Setup;

  beforeAll(async () => {
    ctx = await setup();
    console.info('customers-read-allowed', ctx.allowed);
  });

  it('busca por telefone inexistente responde lista vazia (ou 403 sem permissão)', async () => {
    const result = await probe(ctx.http, { phone: randomPhone() });
    expect([200, 403]).toContain(result.status);
    if (result.status === 200) expect(result.count).toBe(0);
  });

  it('cliente tipado: findByPhone de telefone inexistente devolve [] ou 403', async () => {
    const outcome = await ctx.revgas.customers.findByPhone(randomPhone()).then(
      list => list,
      (error: unknown) => statusOf(error),
    );
    expect(outcome === 403 || (Array.isArray(outcome) && outcome.length === 0)).toBe(true);
  });

  it('parametro cpf desconhecido: registra se a API o ignora', async ctx2 => {
    if (!ctx.allowed) ctx2.skip();
    const unfiltered = await probe(ctx.http, { page_size: '1' });
    const withCpf = await probe(ctx.http, { cpf: randomCpf(), page_size: '1' });
    const withCpfOrCnpj = await probe(ctx.http, { cpf_or_cnpj: randomCpf(), page_size: '1' });
    console.info('cpf-param', JSON.stringify({ unfiltered, withCpf, withCpfOrCnpj }));
    expect(withCpfOrCnpj.status).toBe(200);
  });
});

describe.skipIf(!env.REVGAS_API_KEY || !WRITES)('RevGás API real: clientes (escrita)', () => {
  const cpf = randomCpf();
  const phone = randomPhone();
  const otherPhone = randomPhone();
  const address = {
    location: 'Rua Teste',
    number: '100',
    neighborhood: 'Centro',
    city: 'Teresina',
    state_federation: 'PI',
    postal_code: '64000000',
    type: 'PHYSICAL',
  };
  let ctx: Setup;
  let created: RevgasCustomer;

  async function search(query: Record<string, string>) {
    return ctx.http.request({ method: 'GET', path: '/customers', query, schema: pageOfIds });
  }

  beforeAll(async () => {
    ctx = await setup();
  });

  it('cria cliente com endereço completo', async c => {
    if (!ctx.allowed) c.skip();
    created = await ctx.revgas.customers.create({
      name: 'TESTE BOT REVGAS',
      cpf,
      phones: [phone],
      complement: 'Casa',
      landmark: 'Perto da praca',
      ...address,
    } as never);
    console.info(
      'created',
      JSON.stringify({ id: created.id, cpf: maskCpf(cpf), keys: Object.keys(created) }),
    );
    expect(created.id).toBeGreaterThan(0);
  });

  it('GET /customers/{id} devolve os campos salvos', async c => {
    if (!created) c.skip();
    const customer = await ctx.revgas.customers.get(created.id);
    console.info(
      'stored',
      JSON.stringify({
        cpfOnlyDigits: customer.cpf === cpf,
        phonesShape: (customer.phones ?? []).map(p => p.replace(/\d/g, '9')),
        postalShape: customer.postal_code?.replace(/\d/g, '9'),
        state: customer.state_federation,
        city: customer.city,
        keys: Object.keys(customer),
      }),
    );
    expect(customer.id).toBe(created.id);
  });

  it('busca por telefone com e sem DDI 55', async c => {
    if (!created) c.skip();
    const withDdi = await search({ phone });
    const withoutDdi = await search({ phone: phone.slice(2) });
    const typed = await ctx.revgas.customers.findByPhone(phone);
    expect(withDdi.data.some(item => item.id === created.id)).toBe(true);
    expect(withoutDdi.data.some(item => item.id === created.id)).toBe(true);
    expect(typed.some(item => item.id === created.id)).toBe(true);
  });

  it('busca por cpf_or_cnpj: exata, mascarada, parcial e inexistente', async c => {
    if (!created) c.skip();
    const masked = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    const cases: Record<string, string> = {
      exact: cpf,
      masked,
      partial: cpf.slice(0, 6),
      nonexistent: randomCpf(),
    };
    const results: Record<string, { total: number; hit: boolean } | { status: number | null }> = {};
    for (const [label, value] of Object.entries(cases)) {
      try {
        const page = await search({ cpf_or_cnpj: value });
        results[label] = {
          total: page.pagination.total_count,
          hit: page.data.some(item => item.id === created.id),
        };
      } catch (error) {
        results[label] = { status: statusOf(error) };
      }
    }
    console.info('cpf-search', JSON.stringify(results));
    expect(results.exact).toMatchObject({ hit: true });
    expect(results.nonexistent).toMatchObject({ hit: false });
  });

  it('CPF duplicado com outro telefone', async c => {
    if (!created) c.skip();
    let outcome: Record<string, unknown>;
    try {
      const dup = await ctx.revgas.customers.create({
        name: 'TESTE BOT REVGAS DUP',
        cpf,
        phones: [otherPhone],
        ...address,
      } as never);
      outcome = { created: true, sameId: dup.id === created.id };
    } catch (error) {
      outcome = {
        created: false,
        kind: error instanceof RevgasError ? error.kind : 'other',
        status: statusOf(error),
      };
    }
    console.info('duplicate', JSON.stringify(outcome));
    expect(outcome).toBeDefined();
  });
});
