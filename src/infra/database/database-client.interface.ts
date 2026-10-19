import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schemas/index';

export interface IDatabaseClient {
  getInstance(): NodePgDatabase<typeof schema>;
}
