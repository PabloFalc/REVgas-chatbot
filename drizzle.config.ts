import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infra/database/schema",
  out: "./src/infra/database/migrations",
  casing: "snake_case",
  strict: true,
  verbose: true,
});
