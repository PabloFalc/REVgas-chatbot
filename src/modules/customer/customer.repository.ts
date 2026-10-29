import { Inject, Injectable } from '@nestjs/common';
import { RevgasDuplicateError, RevgasValidationError } from '../../core/erros/revgas/revgas.errors';
import type { RevgasCustomer } from '../../integrations/revgas/customers/customers.schemas';
import { REVGAS_CLIENT, type RevgasClient } from '../../integrations/revgas/revgas.client';
import type { RevgasSale } from '../../integrations/revgas/sales/sales.schemas';
import { normalizeText } from '../../utils/text';
import type { Address } from '../address/contracts/address.types';
import {
  CpfTakenError,
  type Customer,
  type CustomerHistory,
  CustomerRejectedError,
  type LastOrder,
  type NewCustomer,
} from './contracts/customer.types';

const HISTORY_SALES = 20;

interface RawAddress {
  location?: string | null;
  number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state_federation?: string | null;
  complement?: string | null;
  landmark?: string | null;
  postal_code?: string | null;
}

const digitsOnly = (value: string): string => value.replace(/\D/g, '');

const lastSaleTime = (customer: RevgasCustomer): number => {
  if (typeof customer.last_sale !== 'string') {
    return Number.NEGATIVE_INFINITY;
  }
  const time = Date.parse(customer.last_sale);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

const toCustomer = (customer: RevgasCustomer): Customer => ({
  id: customer.id,
  name: customer.name ?? '',
  cpf: customer.cpf ?? null,
  tagId: customer.tag_id ?? null,
});

const toAddress = (raw: RawAddress): Address | null => {
  const street = raw.location?.trim();
  const number = raw.number?.trim();
  const neighborhood = raw.neighborhood?.trim();
  const city = raw.city?.trim();
  const state = raw.state_federation?.trim();
  if (!street || !number || !neighborhood || !city || !state) {
    return null;
  }
  const address: Address = {
    street,
    number,
    neighborhood,
    city,
    state,
  };
  if (raw.complement) {
    address.complement = raw.complement;
  }
  if (raw.landmark) {
    address.landmark = raw.landmark;
  }
  if (raw.postal_code) {
    address.postalCode = raw.postal_code;
  }
  return address;
};

const saleTime = (sale: RevgasSale): number => {
  const raw = sale.created_at ?? sale.date;
  if (typeof raw !== 'string') {
    return Number.NEGATIVE_INFINITY;
  }
  const time = Date.parse(raw.replace(' ', 'T'));
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

const newestFirst = (a: RevgasSale, b: RevgasSale): number => {
  const ta = saleTime(a);
  const tb = saleTime(b);
  if (ta === tb) {
    return b.id - a.id;
  }
  return ta > tb ? -1 : 1;
};

const toLastOrder = (sales: RevgasSale[]): LastOrder | undefined => {
  const [latest] = sales.filter(sale => sale.status !== 'CANCEL').sort(newestFirst);
  const products = latest?.products ?? [];
  const payments = latest?.payments ?? [];
  const address = latest ? toAddress(latest) : null;
  if (products.length !== 1 || payments.length !== 1 || !address) {
    return undefined;
  }
  return {
    productId: products[0].product_id,
    quantity: products[0].quantity,
    paymentType: payments[0].payment_type,
    address,
  };
};

const addressKey = (address: Address): string =>
  [address.street, address.number, address.neighborhood].map(normalizeText).join('|');

@Injectable()
export class CustomerRepository {
  constructor(@Inject(REVGAS_CLIENT) private readonly revgas: RevgasClient) {}

  async findByPhone(phone: string): Promise<Customer | null> {
    const found = await this.revgas.customers.findByPhone(phone);
    if (found.length === 0) {
      return null;
    }
    const latest = found.reduce((best, current) => {
      const diff = lastSaleTime(current) - lastSaleTime(best);
      if (diff > 0 || (diff === 0 && current.id > best.id)) {
        return current;
      }
      return best;
    });
    return toCustomer(latest);
  }

  async create(input: NewCustomer): Promise<Customer> {
    const { address } = input;
    try {
      const created = await this.revgas.customers.create({
        name: input.name,
        cpf: digitsOnly(input.cpf),
        phones: [input.phone],
        location: address.street,
        number: address.number,
        neighborhood: address.neighborhood,
        city: address.city,
        state_federation: address.state,
        complement: address.complement,
        landmark: address.landmark,
        postal_code: address.postalCode,
      });
      return toCustomer(created);
    } catch (error) {
      if (error instanceof RevgasDuplicateError) {
        throw new CpfTakenError(error.message);
      }
      if (error instanceof RevgasValidationError) {
        throw new CustomerRejectedError(error.message);
      }
      throw error;
    }
  }

  async history(customerId: number): Promise<CustomerHistory> {
    const [customer, sales] = await Promise.all([
      this.revgas.customers.get(customerId),
      this.revgas.sales.list({ customer_id: customerId, page_size: HISTORY_SALES }),
    ]);

    const candidates = [customer, ...sales.data]
      .map(source => toAddress(source))
      .filter((address): address is Address => address !== null);
    const seen = new Set<string>();
    const addresses = candidates.filter(address => {
      const key = addressKey(address);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    const productIds = [
      ...new Set(sales.data.flatMap(sale => (sale.products ?? []).map(item => item.product_id))),
    ];
    const lastOrder = toLastOrder(sales.data);
    return lastOrder ? { addresses, productIds, lastOrder } : { addresses, productIds };
  }
}
