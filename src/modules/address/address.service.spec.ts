import { LlmUnavailableError } from 'src/core/erros/llm/llm.errors';
import { FakeLlmClient } from 'src/integrations/llm/fake-llm.client';
import { FakeViacepClient } from 'src/integrations/viacep/fake-viacep.client';
import { beforeEach, describe, expect, it } from 'vitest';
import { AddressService } from './address.service';

const nullAi = {
  street: null,
  number: null,
  neighborhood: null,
  city: null,
  state: null,
  postalCode: null,
  complement: null,
  landmark: null,
};

describe('AddressService', () => {
  let viacep: FakeViacepClient;
  let llm: FakeLlmClient;
  let service: AddressService;

  beforeEach(() => {
    viacep = new FakeViacepClient();
    llm = new FakeLlmClient();
    service = new AddressService(viacep, llm);
    viacep.set('64000-000', {
      postalCode: '64000000',
      street: 'Rua do Cep',
      neighborhood: 'Bairro do Cep',
      city: 'Teresina',
      state: 'PI',
    });
  });

  describe('fromCep', () => {
    it('returns the address without number', async () => {
      expect(await service.fromCep('64000000')).toEqual({
        postalCode: '64000000',
        street: 'Rua do Cep',
        neighborhood: 'Bairro do Cep',
        city: 'Teresina',
        state: 'PI',
      });
    });

    it('returns null when the cep does not exist', async () => {
      expect(await service.fromCep('99999999')).toBeNull();
    });

    it('lets ViacepError propagate', async () => {
      viacep.failNext();
      await expect(service.fromCep('64000000')).rejects.toThrow();
    });
  });

  describe('fromText', () => {
    it('calls the llm and drops null fields', async () => {
      llm.queueObject({ ...nullAi, street: 'Rua A', number: '10', neighborhood: 'Centro' });
      const result = await service.fromText('Rua A 10, Centro');
      expect(llm.calls[0]?.operation).toBe('parse-address');
      expect(llm.calls[0]?.schemaName).toBe('address');
      expect(result).toEqual({
        street: 'Rua A',
        number: '10',
        neighborhood: 'Centro',
        city: 'Teresina',
        state: 'PI',
      });
      expect(result).not.toHaveProperty('complement');
    });

    it('fills only missing fields from the cep, keeping typed street', async () => {
      llm.queueObject({ ...nullAi, street: 'Rua Digitada', number: '5', postalCode: '64000-000' });
      const result = await service.fromText('Rua Digitada 5 64000-000');
      expect(result).toMatchObject({
        street: 'Rua Digitada',
        number: '5',
        neighborhood: 'Bairro do Cep',
        city: 'Teresina',
        state: 'PI',
      });
    });

    it('normalizes the llm cep to digits', async () => {
      llm.queueObject({ ...nullAi, street: 'Rua A', number: '1', postalCode: '64000-000' });
      const result = await service.fromText('Rua A 1 64000-000');
      expect(result?.postalCode).toBe('64000000');
    });

    it('propagates unexpected errors', async () => {
      llm.respondWith(() => {
        throw new Error('boom');
      });
      await expect(service.fromText('Rua A 1')).rejects.toThrow('boom');
    });

    it('uses the store city and state when missing', async () => {
      llm.queueObject({ ...nullAi, street: 'Rua A', number: '1', neighborhood: 'Centro' });
      const result = await service.fromText('Rua A 1 Centro');
      expect(result?.city).toBe('Teresina');
      expect(result?.state).toBe('PI');
    });

    it('returns null when the llm fails', async () => {
      llm.queueError(new LlmUnavailableError('fora'));
      expect(await service.fromText('Rua A 10')).toBeNull();
    });

    it('continues without completing when viacep fails', async () => {
      viacep.failNext();
      llm.queueObject({ ...nullAi, street: 'Rua A', number: '10', postalCode: '64000000' });
      const result = await service.fromText('Rua A 10 64000000');
      expect(result).toMatchObject({ street: 'Rua A', number: '10' });
      expect(result?.neighborhood).toBeUndefined();
    });

    it('never sends the cpf to the llm', async () => {
      llm.queueObject({ ...nullAi, street: 'Rua A', number: '10', neighborhood: 'Centro' });
      await service.fromText('Rua A 10, Centro, cpf 529.982.247-25');
      llm.queueObject(nullAi);
      await service.fromText('Rua A 10, cpf 52998224725');
      for (const call of llm.calls) {
        const user = call.messages
          .filter(m => m.role === 'user')
          .map(m => m.content)
          .join(' ');
        expect(user).not.toContain('52998224725');
        expect(user).not.toContain('529.982.247-25');
      }
    });
  });

  describe('missingField', () => {
    it('follows street, number, neighborhood order', () => {
      expect(service.missingField({ street: 'Rua A', neighborhood: 'Centro' })).toBe('number');
      expect(service.missingField({})).toBe('street');
      expect(service.missingField({ street: 'Rua A', number: '1' })).toBe('neighborhood');
      expect(service.missingField({ street: 'Rua A', number: '1', neighborhood: 'C' })).toBeNull();
    });
  });
});
