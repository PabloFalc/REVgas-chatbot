import { z } from 'zod';
import { ViacepError } from '../../core/erros/viacep/viacep.errors';
import type { ViacepAddress, ViacepClient } from './viacep.client';

const responseSchema = z.union([
  z.object({ erro: z.union([z.boolean(), z.string()]) }),
  z.object({
    cep: z.string(),
    logradouro: z.string().default(''),
    bairro: z.string().default(''),
    localidade: z.string(),
    uf: z.string(),
  }),
]);

export type HttpViacepClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
};

export class HttpViacepClient implements ViacepClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpViacepClientOptions) {
    this.fetchFn = options.fetch ?? fetch;
  }

  async lookup(cep: string): Promise<ViacepAddress | null> {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) {
      return null;
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.options.baseUrl}/${digits}/json/`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch {
      throw new ViacepError('Falha ao consultar o ViaCEP (rede ou timeout)');
    }

    if (response.status >= 500) {
      throw new ViacepError(`ViaCEP respondeu ${response.status}`, response.status);
    }
    if (response.status === 400 || response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new ViacepError(`ViaCEP respondeu ${response.status}`, response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ViacepError('Resposta do ViaCEP não é JSON', response.status);
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ViacepError('Resposta do ViaCEP fora do formato esperado', response.status);
    }
    const data = parsed.data;
    if ('erro' in data) {
      return null;
    }

    return {
      postalCode: data.cep.replace(/\D/g, ''),
      street: data.logradouro,
      neighborhood: data.bairro,
      city: data.localidade,
      state: data.uf,
    };
  }
}
