import { describe, expect, it } from 'vitest';
import { ViacepError } from '../../core/erros/viacep/viacep.errors';
import { FakeViacepClient } from './fake-viacep.client';

const address = {
  postalCode: '64000000',
  street: 'Rua A',
  neighborhood: 'Centro',
  city: 'Teresina',
  state: 'PI',
};

describe('FakeViacepClient', () => {
  it('devolve o endereço programado, aceitando máscara', async () => {
    const client = new FakeViacepClient();
    client.set('64000-000', address);
    expect(await client.lookup('64000000')).toEqual(address);
    expect(await client.lookup('64000-000')).toEqual(address);
  });

  it('devolve null para CEP desconhecido', async () => {
    expect(await new FakeViacepClient().lookup('11111111')).toBeNull();
  });

  it('failNext faz só a próxima chamada lançar ViacepError', async () => {
    const client = new FakeViacepClient();
    client.set('64000000', address);
    client.failNext();
    await expect(client.lookup('64000000')).rejects.toThrow(ViacepError);
    expect(await client.lookup('64000000')).toEqual(address);
  });
});
