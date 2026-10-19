import { constants } from 'node:zlib';
import compression from '@fastify/compress';
import type { AppSetup } from '../setup';

export const compress: AppSetup = async app => {
  await app.register(compression, {
    encodings: ['br', 'gzip', 'deflate'],
    threshold: 1024,
    brotliOptions: {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 4,
      },
    },
  });
};
