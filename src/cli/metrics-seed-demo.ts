import './metrics-seed-demo.guard';
import { env } from '../config/env';
import { closeDatabasePool, db } from '../infra/database/drizzle-client';
import { formatCliError } from './kb-ingest.args';
import { parseSeedDemoArgs } from './metrics-seed-demo.args';
import { DEMO_DAYS, generateDemoData } from './metrics-seed-demo.data';
import { clearDemo, replaceDemo } from './metrics-seed-demo.store';

async function main(): Promise<void> {
  const args = parseSeedDemoArgs(process.argv.slice(2));
  const database = decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1));
  try {
    if (args.clear) {
      const removed = await clearDemo(db);
      console.log(
        `Banco ${database}: removidos ${removed.events} eventos e ${removed.sales} vendas da demonstração.`,
      );
      return;
    }
    const data = generateDemoData(new Date());
    await replaceDemo(db, data);
    console.log(
      `Banco ${database}: ${data.events.length} eventos e ${data.sales.length} vendas simuladas em ${DEMO_DAYS} dias.`,
    );
  } finally {
    await closeDatabasePool();
  }
}

main().catch((error: unknown) => {
  console.error(formatCliError(error));
  process.exitCode = 1;
});
