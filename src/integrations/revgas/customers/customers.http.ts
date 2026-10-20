import { pageSchema } from '../shared/pagination';
import type { RevgasHttp } from '../shared/revgas-http';
import type { CustomersApi } from './customers.api';
import {
  type RevgasCustomer,
  type RevgasCustomerInput,
  RevgasCustomerSchema,
} from './customers.schemas';

export class CustomersHttp implements CustomersApi {
  constructor(private readonly http: RevgasHttp) {}

  async findByPhone(phone: string): Promise<RevgasCustomer[]> {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) {
      return [];
    }
    const result = await this.http.request({
      method: 'GET',
      path: '/customers',
      query: { phone: digits },
      schema: pageSchema(RevgasCustomerSchema),
    });
    return result.data;
  }

  get(id: number): Promise<RevgasCustomer> {
    return this.http.request({
      method: 'GET',
      path: `/customers/${id}`,
      schema: RevgasCustomerSchema,
    });
  }

  create(input: RevgasCustomerInput): Promise<RevgasCustomer> {
    return this.http.request({
      method: 'POST',
      path: '/customers',
      body: input,
      schema: RevgasCustomerSchema,
    });
  }

  update(id: number, input: RevgasCustomerInput): Promise<RevgasCustomer> {
    return this.http.request({
      method: 'PUT',
      path: `/customers/${id}`,
      body: input,
      schema: RevgasCustomerSchema,
    });
  }
}
