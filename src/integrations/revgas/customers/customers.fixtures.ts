import { FAKE_ID_START } from '../shared/fake-id';
import type { RevgasCustomer } from './customers.schemas';

export const FAKE_CUSTOMERS: RevgasCustomer[] = [
  {
    id: FAKE_ID_START + 401,
    name: 'Cliente Demo Um',
    cpf: '00000000191',
    phones: ['5586900000001'],
    location: 'Rua Exemplo',
    number: '100',
    neighborhood: 'Centro',
    city: 'Teresina',
    state_federation: 'PI',
    tag_id: 3519,
  },
  {
    id: FAKE_ID_START + 402,
    name: 'Cliente Demo Dois',
    cpf: '00000000272',
    phones: ['5586900000002'],
    location: 'Avenida Modelo',
    number: '200',
    neighborhood: 'Fatima',
    city: 'Teresina',
    state_federation: 'PI',
  },
];
