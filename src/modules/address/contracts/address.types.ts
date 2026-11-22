export interface Address {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  complement?: string;
  landmark?: string;
  postalCode?: string;
}

export type AddressDraft = Partial<Address>;

export type AddressField = 'street' | 'number' | 'neighborhood';
