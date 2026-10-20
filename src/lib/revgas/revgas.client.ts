import type {
  RevgasCustomer,
  RevgasCustomerInput,
  RevgasDeal,
  RevgasEstablishment,
  RevgasPagination,
  RevgasPaymentType,
  RevgasProduct,
  RevgasSale,
  RevgasSaleInput,
} from './revgas.schemas';

export const REVGAS_CLIENT = Symbol('REVGAS_CLIENT');

export type Page<T> = { data: T[]; pagination: RevgasPagination };
export type PageQuery = { page?: number; page_size?: number };
export type ListProductsQuery = PageQuery & { inactive?: boolean; description?: string };
export type ListDealsQuery = PageQuery & {
  product_id?: number;
  customer_id?: number;
  tag_id?: number;
  payment_type?: string;
};
export type ListSalesQuery = PageQuery & {
  customer_id?: number;
  channel?: string;
  status?: string;
  from?: string;
  to?: string;
};

export interface RevgasClient {
  listEstablishments(): Promise<Page<RevgasEstablishment>>;
  listProducts(query?: ListProductsQuery): Promise<Page<RevgasProduct>>;
  listDeals(query?: ListDealsQuery): Promise<Page<RevgasDeal>>;
  listAllDeals(query?: Omit<ListDealsQuery, 'page' | 'page_size'>): Promise<RevgasDeal[]>;
  listPaymentTypes(): Promise<RevgasPaymentType[]>;
  findCustomersByPhone(phone: string): Promise<RevgasCustomer[]>;
  getCustomer(id: number): Promise<RevgasCustomer>;
  createCustomer(input: RevgasCustomerInput): Promise<RevgasCustomer>;
  updateCustomer(id: number, input: RevgasCustomerInput): Promise<RevgasCustomer>;
  createSale(input: RevgasSaleInput): Promise<RevgasSale>;
  getSale(id: number): Promise<RevgasSale>;
  listSales(query?: ListSalesQuery): Promise<Page<RevgasSale>>;
  cancelSale(id: number, motiveCancelSaleId?: number | null): Promise<RevgasSale>;
}
