import { type Page, pageSchema } from '../shared/pagination';
import type { RevgasHttp } from '../shared/revgas-http';
import type { EstablishmentsApi } from './establishments.api';
import { type RevgasEstablishment, RevgasEstablishmentSchema } from './establishments.schemas';

export class EstablishmentsHttp implements EstablishmentsApi {
  constructor(private readonly http: RevgasHttp) {}

  list(): Promise<Page<RevgasEstablishment>> {
    return this.http.request({
      method: 'GET',
      path: '/establishments',
      schema: pageSchema(RevgasEstablishmentSchema),
    });
  }
}
