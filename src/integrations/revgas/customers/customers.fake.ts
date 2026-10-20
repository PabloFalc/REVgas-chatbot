import { clone } from '../shared/clone';
import { FAKE_ID_START } from '../shared/fake-id';
import {
  RevgasDuplicateError,
  RevgasNotFoundError,
  RevgasValidationError,
} from '../shared/revgas.errors';
import type { CustomersApi } from './customers.api';
import { FAKE_CUSTOMERS } from './customers.fixtures';
import type { RevgasCustomer, RevgasCustomerInput } from './customers.schemas';

const digits = (value: string): string => value.replace(/\D/g, '');

const nationalNumber = (value: string): string => {
  const only = digits(value);
  return (only.length === 12 || only.length === 13) && only.startsWith('55') ? only.slice(2) : only;
};

const samePhone = (a: string, b: string): boolean => {
  const left = nationalNumber(a);
  const right = nationalNumber(b);
  if (left.length === right.length) {
    return left.length >= 10 && left.length <= 11 && left === right;
  }
  const lengths = [left.length, right.length].sort();
  return (
    lengths[0] === 10 &&
    lengths[1] === 11 &&
    left.slice(0, 2) === right.slice(0, 2) &&
    left.slice(-8) === right.slice(-8)
  );
};

export class CustomersFake implements CustomersApi {
  private readonly customers = new Map<number, RevgasCustomer>();
  private nextId = FAKE_ID_START + 1000;

  constructor(seedCustomers: RevgasCustomer[] = []) {
    for (const customer of [...FAKE_CUSTOMERS, ...seedCustomers]) {
      this.customers.set(customer.id, clone(customer));
      if (customer.id >= this.nextId) {
        this.nextId = customer.id + 1;
      }
    }
  }

  owns(id: number): boolean {
    return id >= FAKE_ID_START && this.customers.has(id);
  }

  peek(id: number): RevgasCustomer | undefined {
    const customer = this.customers.get(id);
    return customer && clone(customer);
  }

  async findByPhone(phone: string): Promise<RevgasCustomer[]> {
    const length = digits(phone).length;
    if (length < 10 || length > 13) {
      return [];
    }
    return clone(
      [...this.customers.values()].filter(customer =>
        (customer.phones ?? []).some(candidate => samePhone(candidate, phone)),
      ),
    );
  }

  async get(id: number): Promise<RevgasCustomer> {
    return clone(this.require(id));
  }

  async create(input: RevgasCustomerInput): Promise<RevgasCustomer> {
    const phones = input.phones ?? [];
    if (phones.some(phone => ![12, 13].includes(digits(phone).length))) {
      throw new RevgasValidationError('invalid customer input', [
        { field: 'phones', message: 'phones must have 12 or 13 digits' },
      ]);
    }
    for (const phone of phones) {
      const existing = [...this.customers.values()].find(customer =>
        (customer.phones ?? []).some(candidate => samePhone(candidate, phone)),
      );
      if (existing) {
        throw new RevgasDuplicateError('duplicate object', existing.id);
      }
    }
    const customer: RevgasCustomer = { ...clone(input), id: this.nextId++ };
    this.customers.set(customer.id, customer);
    return clone(customer);
  }

  async update(id: number, input: RevgasCustomerInput): Promise<RevgasCustomer> {
    const current = this.require(id);
    const updated: RevgasCustomer = { ...current, ...clone(input), id };
    this.customers.set(id, updated);
    return clone(updated);
  }

  private require(id: number): RevgasCustomer {
    const customer = this.customers.get(id);
    if (!customer) {
      throw new RevgasNotFoundError('customer not found');
    }
    return customer;
  }
}
