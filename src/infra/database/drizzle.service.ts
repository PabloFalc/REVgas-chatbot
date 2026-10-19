import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { IDatabaseClient } from './database-client.interface';
import { DRIZZLE } from './drizzle-client';
import type * as schema from './schemas/index';

@Injectable()
export class DrizzleService implements IDatabaseClient {
  constructor(@Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>) {}

  getInstance(): NodePgDatabase<typeof schema> {
    return this.db;
  }
}
