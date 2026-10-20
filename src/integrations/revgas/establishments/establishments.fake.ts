import { type Page, paginate } from '../shared/pagination';
import type { EstablishmentsApi } from './establishments.api';
import { FAKE_ESTABLISHMENT } from './establishments.fixtures';
import type { RevgasEstablishment } from './establishments.schemas';

export class EstablishmentsFake implements EstablishmentsApi {
  async list(): Promise<Page<RevgasEstablishment>> {
    return paginate([FAKE_ESTABLISHMENT]);
  }
}
