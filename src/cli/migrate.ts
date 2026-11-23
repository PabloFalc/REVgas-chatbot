import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDatabasePool, db } from '../infra/database/drizzle-client';
import { formatCliError } from './kb-ingest.args';

async function main(): Promise<void> {
  try {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
    console.log('Migrations aplicadas.');
  } finally {
    await closeDatabasePool();
  }
}

main().catch((error: unknown) => {
  console.error(formatCliError(error));
  process.exitCode = 1;
});
