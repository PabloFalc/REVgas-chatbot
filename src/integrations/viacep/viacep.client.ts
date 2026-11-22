export const VIACEP_CLIENT = Symbol('VIACEP_CLIENT');

export interface ViacepAddress {
  postalCode: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

export interface ViacepClient {
  lookup(cep: string): Promise<ViacepAddress | null>;
}
