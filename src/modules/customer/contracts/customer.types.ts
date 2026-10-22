import type { Address } from 'src/modules/address/contracts/address.types';

export interface Customer {
  id: number;
  name: string;
  cpf: string | null;
  tagId: number | null;
}

export interface NewCustomer {
  phone: string;
  name: string;
  cpf: string;
  address: Address;
}

export interface CustomerHistory {
  addresses: Address[];
  productIds: number[];
}

export class CpfTakenError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class CustomerRejectedError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}
