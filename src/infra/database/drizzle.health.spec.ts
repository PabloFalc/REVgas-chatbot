import { DrizzleHealthService } from './drizzle.health';

const registry = { register: () => {} };

function build(execute: () => Promise<unknown>) {
  return new DrizzleHealthService({ execute } as never, registry as never);
}

describe('DrizzleHealthService', () => {
  it('retorna ok quando a consulta responde', async () => {
    const result = await build(async () => [{ '?column?': 1 }]).check();

    expect(result.status).toBe('ok');
  });

  it('retorna error sem expor host, usuário ou conexão quando a consulta falha', async () => {
    const result = await build(async () => {
      throw new Error('connect ECONNREFUSED 10.1.2.3:5432 user=docker postgresql://docker:s3@db/x');
    }).check();

    expect(result.status).toBe('error');
    expect(JSON.stringify(result)).not.toMatch(/10\.1\.2\.3|docker|postgresql/);
  });

  it('retorna error por timeout quando a consulta não responde', async () => {
    vi.useFakeTimers();
    const pending = build(() => new Promise(() => {})).check();
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;
    vi.useRealTimers();

    expect(result).toMatchObject({ status: 'error', error: 'Database timeout' });
  });
});
