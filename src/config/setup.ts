import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { compress } from './plugins/compress.config';
import { cors } from './plugins/cors.config';
import { helmet } from './plugins/helmet.config';
import { pino } from './plugins/pino.config';
import { swagger } from './plugins/swagger.config';
import { pressure } from './plugins/under-pressure.config';

export type AppSetup = (app: NestFastifyApplication) => void | Promise<void>;

const configs: AppSetup[] = [pino, compress, pressure, cors, helmet, swagger];

export async function setupPlugins(app: NestFastifyApplication) {
  for (const config of configs) {
    await config(app);
  }
}
