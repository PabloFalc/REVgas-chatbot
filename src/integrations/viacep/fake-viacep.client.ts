import { ViacepError } from '../../core/erros/viacep/viacep.errors';
import type { ViacepAddress, ViacepClient } from './viacep.client';

export class FakeViacepClient implements ViacepClient {
  private readonly addresses = new Map<string, ViacepAddress>();
  private failureQueued = false;

  set(cep: string, address: ViacepAddress): void {
    this.addresses.set(cep.replace(/\D/g, ''), address);
  }

  failNext(): void {
    this.failureQueued = true;
  }

  async lookup(cep: string): Promise<ViacepAddress | null> {
    if (this.failureQueued) {
      this.failureQueued = false;
      throw new ViacepError('Falha simulada do ViaCEP');
    }
    return this.addresses.get(cep.replace(/\D/g, '')) ?? null;
  }
}
