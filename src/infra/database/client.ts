import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { env } from "../../config/env";
import * as schema from "./schema";

const sslMode = env.DB_SSL_MODE ?? (env.NODE_ENV === "production" ? "verify-full" : "disable");

function tlsOptions() {
  if (sslMode === "disable") return false;
  if (sslMode === "require") return { rejectUnauthorized: false };
  if (!env.DB_SSL_CA_PATH) return { rejectUnauthorized: true };
  return { rejectUnauthorized: true, ca: Bun.file(env.DB_SSL_CA_PATH) };
}

const client = new SQL({ url: env.DATABASE_URL, tls: tlsOptions() });

export const db = drizzle({ client, schema, casing: "snake_case" });
