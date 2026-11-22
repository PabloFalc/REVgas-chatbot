import { Logger } from '@nestjs/common';
import { env } from './config/env';
import { createServer } from './server';

async function bootstrap() {
  const app = await createServer();

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
