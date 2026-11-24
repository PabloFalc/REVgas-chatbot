import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import supertest from 'supertest';
import { createApp } from './setup-e2e';

describe('AppModule (e2e)', () => {
  let app: NestFastifyApplication;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    app = await createApp();
    request = supertest(app.getHttpServer());
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  it('responde o health check', async () => {
    const response = await request.get('/health');

    expect(response.status).toBe(200);
  });
});
