import type { RevgasCustomer, RevgasCustomerInput } from './customers.schemas';

export interface CustomersApi {
  findByPhone(phone: string): Promise<RevgasCustomer[]>;
  get(id: number): Promise<RevgasCustomer>;
  create(input: RevgasCustomerInput): Promise<RevgasCustomer>;
  update(id: number, input: RevgasCustomerInput): Promise<RevgasCustomer>;
}
