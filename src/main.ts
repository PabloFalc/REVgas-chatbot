import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { env } from './config/env';
import { setupPlugins } from './config/setup';
import { parseTrustProxy } from './config/trust-proxy';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: parseTrustProxy(env.TRUSTED_PROXY),
      bodyLimit: 2 * 1024 * 1024,
    }),
    { bufferLogs: true, rawBody: true },
  );

  await setupPlugins(app);

  app.enableShutdownHooks();

  await app.listen(env.PORT, env.HOST);

  const logger = new Logger('Bootstrap');
  logger.log(`API rodando em http://${env.HOST}:${env.PORT}`);

  if (env.NODE_ENV !== 'production') {
    logger.log(`Docs em http://${env.HOST}:${env.PORT}/docs`);
  }

  logger.log(`Ambiente: ${env.NODE_ENV}`);
}

void bootstrap();
