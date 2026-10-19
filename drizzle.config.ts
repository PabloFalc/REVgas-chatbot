import { defineConfig } from 'drizzle-kit';
import { env } from 'src/config/env';

export default defineConfig({
  out: './drizzle',
  schema: 'src/infra/database/schemas/index.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
