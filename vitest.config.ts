import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://docker:docker@localhost:5432/test_db',
      DOTENV_CONFIG_PATH: '/dev/null',
    },
    include: ['src/**/*.spec.ts'],
    alias: {
      src: resolve(__dirname, './src'),
    },
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
});
