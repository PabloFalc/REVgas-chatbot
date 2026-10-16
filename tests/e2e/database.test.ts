import { afterAll, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../../src/infra/database/client";

afterAll(() => db.$client.close());

test("connects to the database", async () => {
  const result = await db.execute(sql`select 1 as ok`);
  expect(result[0]).toEqual({ ok: 1 });
});
