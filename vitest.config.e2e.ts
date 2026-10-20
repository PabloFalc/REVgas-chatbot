import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.e2e.spec.ts'],
    fileParallelism: false,
    env: {
      WHATSAPP_MODE: 'fake',
      WHATSAPP_PHONE_NUMBER_ID: '1122334455',
      WHATSAPP_APP_SECRET: 'e2e-whatsapp-app-secret-0123456789',
      WHATSAPP_VERIFY_TOKEN: 'e2e-whatsapp-verify-token',
    },
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
