import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import scalarApiReference from '@scalar/fastify-api-reference';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { env } from '../env';
import type { AppSetup } from '../setup';

const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
  version: string;
};

export const swagger: AppSetup = async app => {
  if (env.NODE_ENV === 'production') {
    return;
  }

  const docToken = env.DOC_TOKEN;
  const isAuthorizedDocRequest = (header: string | string[] | undefined) =>
    !docToken || header === docToken || (Array.isArray(header) && header.includes(docToken));

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('preHandler', (req, res, done) => {
      if (
        docToken &&
        (req.url.startsWith('/docs') || req.url.startsWith('/openapi.json')) &&
        !isAuthorizedDocRequest(req.headers['x-doc-token'])
      ) {
        void res.status(401).send({ message: 'Unauthorized' });
        return;
      }

      done();
    });

  const config = new DocumentBuilder()
    .setTitle('RevGás Chatbot API')
    .setDescription('API do chatbot de WhatsApp da RevGás')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        description:
          'Token retornado no body de POST /auth/email/sign-in ou POST /auth/email/sign-up.',
      },
      'bearer',
    )
    .addServer(`http://localhost:${env.PORT}`, 'Servidor de desenvolvimento')
    .setVersion(version)
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const cleaned = cleanupOpenApiDoc(document);

  app
    .getHttpAdapter()
    .getInstance()
    .get('/openapi.json', (req, res) => {
      if (!isAuthorizedDocRequest(req.headers['x-doc-token'])) {
        return res.status(401).send({ message: 'Unauthorized' });
      }

      res.send(cleaned);
    });

  await app.register(scalarApiReference, {
    routePrefix: '/docs',
    configuration: {
      url: '/openapi.json',
      theme: 'elysiajs',
      layout: 'modern',
      defaultHttpClient: {
        targetKey: 'js',
        clientKey: 'axios',
      },
    },
  });
};
