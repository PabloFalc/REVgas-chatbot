import { describe, expect, it } from 'vitest';
import { maskQuery } from './mask';

describe('maskQuery', () => {
  it('mascara telefone mantendo os últimos 4 dígitos', () => {
    expect(maskQuery({ phone: '5586999998888' })).toEqual({ phone: '*******8888' });
  });

  it('mascara cpf_or_cnpj mantendo os últimos 2 dígitos', () => {
    expect(maskQuery({ cpf_or_cnpj: '12345678901' })).toEqual({ cpf_or_cnpj: '***01' });
  });

  it('oculta name e location', () => {
    expect(maskQuery({ name: 'Maria', location: 'Rua A' })).toEqual({
      name: '***',
      location: '***',
    });
  });

  it('mantém os demais campos intactos', () => {
    expect(maskQuery({ page: 2, inactive: false })).toEqual({ page: 2, inactive: false });
  });
});
