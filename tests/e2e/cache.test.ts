import { afterAll, expect, test } from "bun:test";
import { cache } from "../../src/infra/cache/client";

const key = `test:${crypto.randomUUID()}`;

afterAll(async () => {
  await cache.delete(key);
  cache.close();
});

test("stores and reads a JSON value", async () => {
  await cache.set(key, { step: "PRODUCT", quantity: 2 });
  expect(await cache.get(key)).toEqual({ step: "PRODUCT", quantity: 2 });
});

test("returns null after delete", async () => {
  await cache.set(key, "value");
  await cache.delete(key);
  expect(await cache.get(key)).toBeNull();
});

test("expires the value after the TTL", async () => {
  await cache.set(key, "value", 1);
  await Bun.sleep(1100);
  expect(await cache.get(key)).toBeNull();
});
