import 'dotenv/config';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

const SUFFIX = '_e2e';
const SAFE_NAME = /^[A-Za-z0-9_]+$/;

export function e2eDatabaseUrl(url: string): { url: string; name: string } {
  const parsed = new URL(url);
  const base = decodeURIComponent(parsed.pathname.slice(1));
  if (!SAFE_NAME.test(base)) throw new Error('Nome do banco inválido para derivar o banco do e2e');
  const name = base.endsWith(SUFFIX) ? base : `${base}${SUFFIX}`;
  parsed.pathname = `/${name}`;
  return { url: parsed.toString(), name };
}

async function ensureDatabase(adminUrl: string, name: string): Promise<void> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!found.rowCount) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

export default async function setup(): Promise<void> {
  const source = process.env.DATABASE_URL;
  if (!source) throw new Error('DATABASE_URL é obrigatória para o e2e');
  const target = e2eDatabaseUrl(source);

  const adminUrl = new URL(source);
  adminUrl.pathname = '/postgres';
  await ensureDatabase(adminUrl.toString(), target.name);

  const client = new Client({ connectionString: target.url });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: resolve(process.cwd(), 'drizzle') });
  } finally {
    await client.end();
  }

  process.env.DATABASE_URL = target.url;
}
