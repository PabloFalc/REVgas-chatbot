import { describe, expect, it, vi } from 'vitest';
import { ViacepError } from '../../core/erros/viacep/viacep.errors';
import { HttpViacepClient } from './http-viacep.client';

const body = {
  cep: '64000-000',
  logradouro: 'Rua Coelho Rodrigues',
  bairro: 'Centro',
  localidade: 'Teresina',
  uf: 'PI',
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const make = (fetchMock: typeof fetch) =>
  new HttpViacepClient({ baseUrl: 'https://viacep.test/ws', timeoutMs: 1000, fetch: fetchMock });

describe('HttpViacepClient', () => {
  it('consulta o CEP e mapeia o endereço', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
    const address = await make(fetchMock as unknown as typeof fetch).lookup('64000-000');

    expect(fetchMock.mock.calls[0][0]).toBe('https://viacep.test/ws/64000000/json/');
    expect(address).toEqual({
      postalCode: '64000000',
      street: 'Rua Coelho Rodrigues',
      neighborhood: 'Centro',
      city: 'Teresina',
      state: 'PI',
    });
  });

  it.each([{ erro: true }, { erro: 'true' }])('devolve null quando %o', async payload => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    expect(await make(fetchMock as unknown as typeof fetch).lookup('64000000')).toBeNull();
  });

  it('devolve null sem chamar fetch quando o CEP não tem 8 dígitos', async () => {
    const fetchMock = vi.fn();
    const client = make(fetchMock as unknown as typeof fetch);
    expect(await client.lookup('123')).toBeNull();
    expect(await client.lookup('123456789')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lança ViacepError em erro de rede', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(make(fetchMock as unknown as typeof fetch).lookup('64000000')).rejects.toThrow(
      ViacepError,
    );
  });

  it('lança ViacepError em timeout', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await expect(make(fetchMock as unknown as typeof fetch).lookup('64000000')).rejects.toThrow(
      ViacepError,
    );
  });

  it('lança ViacepError em status 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('x', { status: 503 }));
    await expect(make(fetchMock as unknown as typeof fetch).lookup('64000000')).rejects.toThrow(
      ViacepError,
    );
  });

  it('lança ViacepError em resposta fora do formato', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ cep: 1 }));
    await expect(make(fetchMock as unknown as typeof fetch).lookup('64000000')).rejects.toThrow(
      ViacepError,
    );
  });
});
