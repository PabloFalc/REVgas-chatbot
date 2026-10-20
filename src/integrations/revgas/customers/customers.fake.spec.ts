import { describe, expect, it } from 'vitest';
import { FAKE_ID_START } from '../shared/fake';
import {
  RevgasDuplicateError,
  RevgasNotFoundError,
  RevgasValidationError,
} from '../shared/revgas.errors';
import { CustomersFake } from './customers.fake';
import { FAKE_CUSTOMERS } from './customers.fixtures';

describe('CustomersFake', () => {
  it('acha cliente com telefone em formatos diferentes', async () => {
    const fake = new CustomersFake();
    const ids = await Promise.all(
      ['5586900000001', '+55 86 90000-0001', '86900000001'].map(async phone => {
        const found = await fake.findByPhone(phone);
        return found.map(customer => customer.id);
      }),
    );
    expect(ids[0]).toEqual([FAKE_CUSTOMERS[0].id]);
    expect(ids[1]).toEqual(ids[0]);
    expect(ids[2]).toEqual(ids[0]);
  });

  it('telefone vazio ou curto não casa ninguém', async () => {
    const fake = new CustomersFake();
    for (const phone of ['', 'abc', '+', '88']) {
      expect(await fake.findByPhone(phone)).toEqual([]);
    }
  });

  it('não casa DDDs diferentes com os mesmos dígitos do assinante', async () => {
    const fake = new CustomersFake();
    expect(await fake.findByPhone('96900000001')).toEqual([]);
    expect(await fake.findByPhone('5596900000001')).toEqual([]);
    const created = await fake.create({ name: 'Outro DDD', phones: ['5596900000001'] });
    expect(created.id).not.toBe(FAKE_CUSTOMERS[0].id);
  });

  it('casa número de 10 dígitos com o de 11 dígitos de mesmo DDD e final', async () => {
    const fake = new CustomersFake();
    const found = await fake.findByPhone('8600000001');
    expect(found.map(customer => customer.id)).toEqual([FAKE_CUSTOMERS[0].id]);
    expect(await fake.findByPhone('9600000001')).toEqual([]);
  });

  it('cadastra cliente e acha pelo telefone', async () => {
    const fake = new CustomersFake();
    const created = await fake.create({ name: 'Novo', phones: ['5586988887777'] });
    expect(created.id).toBeGreaterThanOrEqual(FAKE_ID_START);
    const found = await fake.findByPhone('86988887777');
    expect(found.map(customer => customer.id)).toEqual([created.id]);
    expect((await fake.get(created.id)).name).toBe('Novo');
  });

  it('recusa telefone duplicado com existingId', async () => {
    const fake = new CustomersFake();
    const error = await fake.create({ name: 'Outro', phones: ['5586900000001'] }).catch(e => e);
    expect(error).toBeInstanceOf(RevgasDuplicateError);
    expect(error.existingId).toBe(FAKE_CUSTOMERS[0].id);
  });

  it('recusa phones com 11 dígitos', async () => {
    const fake = new CustomersFake();
    const error = await fake.create({ name: 'X', phones: ['86988887777'] }).catch(e => e);
    expect(error).toBeInstanceOf(RevgasValidationError);
    expect(error.fields.map((f: { field: string }) => f.field)).toContain('phones');
  });

  it('atualiza e lê cliente, inexistente lança NotFound', async () => {
    const fake = new CustomersFake();
    const updated = await fake.update(FAKE_CUSTOMERS[0].id, { city: 'Timon' });
    expect(updated.city).toBe('Timon');
    await expect(fake.get(1)).rejects.toBeInstanceOf(RevgasNotFoundError);
    await expect(fake.update(1, {})).rejects.toBeInstanceOf(RevgasNotFoundError);
  });

  it('não expõe estado interno por mutação', async () => {
    const fake = new CustomersFake();
    const customer = await fake.get(FAKE_CUSTOMERS[0].id);
    customer.name = 'Alterado';
    expect((await fake.get(FAKE_CUSTOMERS[0].id)).name).not.toBe('Alterado');
  });

  it('owns é verdadeiro só para ids >= FAKE_ID_START criados ou semeados', async () => {
    const fake = new CustomersFake([
      { id: 5, name: 'Baixo' },
      { id: FAKE_ID_START + 900, name: 'Alto' },
    ]);
    expect(fake.owns(FAKE_CUSTOMERS[0].id)).toBe(true);
    expect(fake.owns(FAKE_ID_START + 900)).toBe(true);
    expect(fake.owns(5)).toBe(false);
    expect(fake.owns(FAKE_ID_START + 12345)).toBe(false);
    const created = await fake.create({ phones: ['5586911112222'] });
    expect(fake.owns(created.id)).toBe(true);
  });
});
