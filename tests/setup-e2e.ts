import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from 'src/app.module';
import { setupPlugins } from 'src/config/setup';

process.env.NODE_ENV = 'test';

type ModuleImport = Type | DynamicModule;

export async function createApp(
  extraImports: ModuleImport[] = [],
): Promise<NestFastifyApplication> {
  @Module({ imports: [AppModule, ...extraImports] })
  class TestAppModule {}

  const app = await NestFactory.create<NestFastifyApplication>(
    TestAppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 2 * 1024 * 1024 }),
    { bufferLogs: true, logger: false, rawBody: true },
  );

  await setupPlugins(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return app;
}
