import type { Page } from '../shared/pagination';
import type { RevgasEstablishment } from './establishments.schemas';

export interface EstablishmentsApi {
  list(): Promise<Page<RevgasEstablishment>>;
}
