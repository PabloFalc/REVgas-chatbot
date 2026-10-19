import { Controller, Get, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { db } from 'src/infra/database/drizzle-client';
import supertest from 'supertest';
import { createApp } from '../setup-e2e';

@Controller('__test__/db')
class DatabaseErrorController {
  @Get('division-by-zero')
  divisionByZero() {
    return db.execute(sql`select 1 / 0`);
  }

  @Get('missing-table')
  missingTable() {
    return db.execute(sql`select * from tabela_que_nao_existe`);
  }
}

@Module({ controllers: [DatabaseErrorController] })
class DatabaseErrorModule {}

describe('DrizzleExceptionFilter (e2e)', () => {
  let app: NestFastifyApplication;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    app = await createApp([DatabaseErrorModule]);
    request = supertest(app.getHttpServer());
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  it('traduz erro de dado do Postgres em 400', async () => {
    const response = await request.get('/__test__/db/division-by-zero');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'BAD_REQUEST', message: 'Dado inválido' });
    expect(response.body.details.pgCode).toBe('22012');
  });

  it('traduz erro de schema em 500 sem cair no filtro genérico', async () => {
    const response = await request.get('/__test__/db/missing-table');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(response.body.details.pgCode).toBe('42P01');
  });
});
