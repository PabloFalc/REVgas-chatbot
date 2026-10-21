import { describe, expect, it, vi } from 'vitest';
import { RevgasDuplicateError, RevgasValidationError } from '../../core/erros/revgas/revgas.errors';
import type { RevgasCustomer } from '../../integrations/revgas/customers/customers.schemas';
import { FakeRevgasClient } from '../../integrations/revgas/fake-revgas.client';
import type { Address } from '../address/contracts/address.types';
import { CpfTakenError, CustomerRejectedError } from './contracts/customer.types';
import { CustomerRepository } from './customer.repository';

const PHONE = '5586999990000';

const address: Address = {
  street: 'Rua das Flores',
  number: '10',
  neighborhood: 'Centro',
  city: 'Teresina',
  state: 'PI',
  complement: 'Apto 2',
  landmark: 'Perto da praça',
  postalCode: '64000000',
};

const seeded = (overrides: Partial<RevgasCustomer> & { id: number }): RevgasCustomer => ({
  name: 'Maria',
  cpf: null,
  phones: [PHONE],
  ...overrides,
});

const build = (seedCustomers: RevgasCustomer[] = []) => {
  const client = new FakeRevgasClient({ seedCustomers });
  return { client, repository: new CustomerRepository(client) };
};

describe('CustomerRepository', () => {
  describe('findByPhone', () => {
    it('finds the customer by phone', async () => {
      const { repository } = build([
        seeded({ id: 5001, name: 'Maria', tag_id: 7, cpf: '11144477735' }),
      ]);

      expect(await repository.findByPhone(PHONE)).toEqual({
        id: 5001,
        name: 'Maria',
        cpf: '11144477735',
        tagId: 7,
      });
    });

    it('picks the customer with the most recent last_sale when several share the phone', async () => {
      const { repository } = build([
        seeded({ id: 5001, name: 'Antigo', last_sale: '2024-01-01T00:00:00' }),
        seeded({ id: 5002, name: 'Recente', last_sale: '2025-06-01T00:00:00' }),
        seeded({ id: 5003, name: 'Sem compra' }),
      ]);

      expect((await repository.findByPhone(PHONE))?.name).toBe('Recente');
    });

    it('returns null when nobody matches', async () => {
      const { repository } = build();

      expect(await repository.findByPhone(PHONE)).toBeNull();
    });
  });

  describe('create', () => {
    it('sends phone, digits-only cpf and the address fields', async () => {
      const { client, repository } = build();
      const spy = vi.spyOn(client.customers, 'create');

      const customer = await repository.create({
        phone: PHONE,
        name: 'João',
        cpf: '111.444.777-35',
        address,
      });

      expect(spy).toHaveBeenCalledWith({
        name: 'João',
        cpf: '11144477735',
        phones: [PHONE],
        location: 'Rua das Flores',
        number: '10',
        neighborhood: 'Centro',
        city: 'Teresina',
        state_federation: 'PI',
        complement: 'Apto 2',
        landmark: 'Perto da praça',
        postal_code: '64000000',
      });
      expect(customer).toMatchObject({ name: 'João', cpf: '11144477735', tagId: null });
    });

    it('maps RevgasDuplicateError to CpfTakenError', async () => {
      const { client, repository } = build();
      vi.spyOn(client.customers, 'create').mockRejectedValue(new RevgasDuplicateError('dup', 1));

      await expect(
        repository.create({ phone: PHONE, name: 'João', cpf: '11144477735', address }),
      ).rejects.toBeInstanceOf(CpfTakenError);
    });

    it('maps RevgasValidationError to CustomerRejectedError', async () => {
      const { client, repository } = build();
      vi.spyOn(client.customers, 'create').mockRejectedValue(
        new RevgasValidationError('invalid', [{ field: 'cpf', message: 'invalid' }]),
      );

      await expect(
        repository.create({ phone: PHONE, name: 'João', cpf: '11144477735', address }),
      ).rejects.toBeInstanceOf(CustomerRejectedError);
    });

    it('propagates unexpected errors', async () => {
      const { client, repository } = build();
      const boom = new Error('boom');
      vi.spyOn(client.customers, 'create').mockRejectedValue(boom);

      await expect(
        repository.create({ phone: PHONE, name: 'João', cpf: '11144477735', address }),
      ).rejects.toBe(boom);
    });
  });

  describe('saveCpf', () => {
    it('updates the customer cpf with digits only', async () => {
      const { client, repository } = build([seeded({ id: 5001 })]);

      await repository.saveCpf(5001, '111.444.777-35');

      expect((await client.customers.get(5001)).cpf).toBe('11144477735');
    });

    it('maps RevgasDuplicateError to CpfTakenError', async () => {
      const { client, repository } = build([seeded({ id: 5001 })]);
      vi.spyOn(client.customers, 'update').mockRejectedValue(new RevgasDuplicateError('dup', 1));

      await expect(repository.saveCpf(5001, '11144477735')).rejects.toBeInstanceOf(CpfTakenError);
    });

    it('maps RevgasValidationError to CustomerRejectedError', async () => {
      const { client, repository } = build([seeded({ id: 5001 })]);
      vi.spyOn(client.customers, 'update').mockRejectedValue(
        new RevgasValidationError('invalid', [{ field: 'cpf', message: 'invalid' }]),
      );

      await expect(repository.saveCpf(5001, '11144477735')).rejects.toBeInstanceOf(
        CustomerRejectedError,
      );
    });

    it('propagates unexpected errors', async () => {
      const { client, repository } = build([seeded({ id: 5001 })]);
      const boom = new Error('boom');
      vi.spyOn(client.customers, 'update').mockRejectedValue(boom);

      await expect(repository.saveCpf(5001, '11144477735')).rejects.toBe(boom);
    });
  });

  describe('history', () => {
    const saleBase = {
      location: 'Rua B',
      number: '20',
      neighborhood: 'Fátima',
      city: 'Teresina',
      state_federation: 'PI',
      payments: [{ payment_type: 'CASH', value: 100 }],
    };

    it('lists the registration address first, then sale addresses without repeats, and product ids', async () => {
      const { client, repository } = build([
        seeded({
          id: 5001,
          location: 'Rua das Flores',
          number: '10',
          neighborhood: 'Centro',
          city: 'Teresina',
          state_federation: 'PI',
        }),
      ]);
      await client.sales.create({
        ...saleBase,
        customer_id: 5001,
        products: [{ product_id: 1, quantity: 1, value: 100 }],
      });
      await client.sales.create({
        ...saleBase,
        location: 'RUA DAS FLORES',
        number: '10',
        neighborhood: 'centro',
        customer_id: 5001,
        products: [
          { product_id: 1, quantity: 1, value: 100 },
          { product_id: 2, quantity: 1, value: 50 },
        ],
      });

      const history = await repository.history(5001);

      expect(history.addresses.map(item => item.street)).toEqual(['Rua das Flores', 'Rua B']);
      expect(history.addresses[1]).toMatchObject({
        number: '20',
        neighborhood: 'Fátima',
        city: 'Teresina',
        state: 'PI',
      });
      expect(history.productIds.sort()).toEqual([1, 2]);
      expect(new Set(history.productIds).size).toBe(history.productIds.length);
    });

    it('requests the last 20 sales of the customer', async () => {
      const { client, repository } = build([seeded({ id: 5001 })]);
      const spy = vi.spyOn(client.sales, 'list');

      await repository.history(5001);

      expect(spy).toHaveBeenCalledWith({ customer_id: 5001, page_size: 20 });
    });

    it('drops addresses missing street, number or neighborhood', async () => {
      const { client, repository } = build([
        seeded({ id: 5001, location: 'Rua Sem Numero', neighborhood: 'Centro' }),
      ]);
      await client.sales.create({
        ...saleBase,
        customer_id: 5001,
        products: [{ product_id: 3, quantity: 1, value: 100 }],
      });

      const history = await repository.history(5001);

      expect(history.addresses.map(item => item.street)).toEqual(['Rua B']);
      expect(history.productIds).toEqual([3]);
    });

    it('drops a registration address without city', async () => {
      const { repository } = build([
        seeded({
          id: 5001,
          location: 'Rua das Flores',
          number: '10',
          neighborhood: 'Centro',
          state_federation: 'PI',
        }),
      ]);

      expect((await repository.history(5001)).addresses).toEqual([]);
    });

    it('drops a sale address without state_federation', async () => {
      const { client, repository } = build([seeded({ id: 5001 })]);
      vi.spyOn(client.sales, 'list').mockResolvedValue({
        data: [
          {
            id: 1,
            status: 'ACTIVE',
            customer_id: 5001,
            location: 'Rua B',
            number: '20',
            neighborhood: 'Fátima',
            city: 'Teresina',
            state_federation: null,
            products: [],
          },
        ],
        pagination: { page: 1, count: 1, total_count: 1 },
      });

      expect((await repository.history(5001)).addresses).toEqual([]);
    });
  });
});
