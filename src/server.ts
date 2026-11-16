import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { env } from './config/env';
import { setupPlugins } from './config/setup';
import { parseTrustProxy } from './config/trust-proxy';

export async function createServer(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: parseTrustProxy(env.TRUSTED_PROXY),
      bodyLimit: 2 * 1024 * 1024,
    }),
    { bufferLogs: true, rawBody: true },
  );

  await setupPlugins(app);
  return app;
}
