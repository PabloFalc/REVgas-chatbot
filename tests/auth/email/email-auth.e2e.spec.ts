import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createEmailVerificationToken } from 'better-auth/api';
import { inArray } from 'drizzle-orm';
import { env } from 'src/config/env';
import { db } from 'src/infra/database/drizzle-client';
import { users, verifications } from 'src/infra/database/schemas';
import { authModule } from 'src/modules/auth/auth.module';
import supertest from 'supertest';
import { bearer, signIn, signUpVerified } from '../../helpers/auth';
import { deleteBy } from '../../helpers/db';
import { createApp } from '../../setup-e2e';

describe('EmailAuthController (e2e)', () => {
  let app: NestFastifyApplication;
  let request: ReturnType<typeof supertest>;

  const user = {
    email: 'user@user.com',
    password: 'Test1234!',
    name: 'user-name',
    userName: 'username',
  };

  const verified = {
    email: 'verified@user.com',
    password: 'Test1234!',
    name: 'Verified User',
    userName: 'verifieduser',
  };

  const testEmails = [user.email, verified.email];

  async function cleanupAuthTables() {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, testEmails));
    await deleteBy(
      verifications,
      verifications.value,
      rows.map(row => row.id),
    );
    await deleteBy(users, users.email, testEmails);
  }

  beforeAll(async () => {
    app = await createApp(authModule);
    request = supertest(app.getHttpServer());
    await cleanupAuthTables();
  }, 30000);

  afterAll(async () => {
    await cleanupAuthTables();
    await app.close();
  }, 30000);

  describe('POST /auth/email/sign-up', () => {
    it('deve criar um usuário e retornar o token', async () => {
      const response = await request.post('/auth/email/sign-up').send(user);

      expect(response.status).toBe(201);
      expect(response.body.token).toEqual(expect.any(String));
      expect(response.body.user.email).toBe(user.email);
    });

    it('deve retornar 409 se usuário já existir', async () => {
      const response = await request.post('/auth/email/sign-up').send(user);

      expect(response.status).toBe(409);
    });

    it('deve retornar 409 se já estiver logado', async () => {
      const token = await signIn(request, user);

      const response = await request.post('/auth/email/sign-up').set(bearer(token)).send(user);

      expect(response.status).toBe(409);
    });
  });

  describe('POST /auth/email/sign-in', () => {
    it('deve autenticar e retornar o token sem setar cookie', async () => {
      const response = await request.post('/auth/email/sign-in').send({
        email: user.email,
        password: user.password,
      });

      expect(response.status).toBe(200);
      expect(response.body.token).toEqual(expect.any(String));
      expect(response.body.user.email).toBe(user.email);
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('deve retornar 401 com credenciais inválidas', async () => {
      const response = await request.post('/auth/email/sign-in').send({
        email: user.email,
        password: 'senhaerrada',
      });

      expect(response.status).toBe(401);
    });

    it('deve retornar 409 se já estiver logado', async () => {
      const token = await signIn(request, user);

      const response = await request
        .post('/auth/email/sign-in')
        .set(bearer(token))
        .send({ email: user.email, password: user.password });

      expect(response.status).toBe(409);
    });
  });

  describe('GET /auth/get-session', () => {
    it('deve retornar a sessão do token informado (mesmo sem email verificado)', async () => {
      const token = await signIn(request, user);

      const response = await request.get('/auth/get-session').set(bearer(token));

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBe(user.email);
    });

    it('deve retornar 401 sem token', async () => {
      const response = await request.get('/auth/get-session');
      expect(response.status).toBe(401);
    });

    it('deve retornar 401 com token inválido', async () => {
      const response = await request.get('/auth/get-session').set(bearer('token-invalido'));
      expect(response.status).toBe(401);
    });
  });

  describe('POST /auth/sign-out', () => {
    it('deve invalidar o token', async () => {
      const token = await signIn(request, user);

      const response = await request.post('/auth/sign-out').set(bearer(token));
      expect(response.status).toBe(200);

      const after = await request.get('/auth/get-session').set(bearer(token));
      expect(after.status).toBe(401);
    });

    it('deve retornar 401 sem token', async () => {
      const response = await request.post('/auth/sign-out');
      expect(response.status).toBe(401);
    });
  });

  describe('Exigência de email verificado', () => {
    it('retorna 403 em rota protegida para usuário não verificado', async () => {
      const token = await signIn(request, user);

      const response = await request.get('/auth/sessions').set(bearer(token));

      expect(response.status).toBe(403);
    });

    it('libera rota protegida para usuário verificado', async () => {
      const token = await signUpVerified(request, verified);

      const response = await request.get('/auth/sessions').set(bearer(token));

      expect(response.status).toBe(200);
    });
  });

  describe('POST /auth/email/forget-password', () => {
    it('deve aceitar a solicitação para um usuário existente', async () => {
      const response = await request
        .post('/auth/email/forget-password')
        .send({ email: user.email, redirectTo: 'http://localhost:3000/reset' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe(true);
    });

    it('não deve vazar a existência de email (retorna 200 para email inexistente)', async () => {
      const response = await request
        .post('/auth/email/forget-password')
        .send({ email: 'naoexiste@user.com', redirectTo: 'http://localhost:3000/reset' });

      expect(response.status).toBe(200);
    });
  });

  describe('POST /auth/email/reset-password', () => {
    it('deve retornar 400 com token inválido', async () => {
      const response = await request
        .post('/auth/email/reset-password')
        .send({ newPassword: 'NovaSenha123!', token: 'token-invalido' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /auth/email/verify-email', () => {
    it('deve reenviar o email de verificação para o usuário autenticado', async () => {
      const token = await signIn(request, user);

      const response = await request
        .post('/auth/email/verify-email')
        .set(bearer(token))
        .send({ callbackURL: 'http://localhost:3000/verified' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe(true);
    });

    it('deve retornar 401 sem token', async () => {
      const response = await request.post('/auth/email/verify-email').send({});

      expect(response.status).toBe(401);
    });
  });

  describe('GET /auth/email/verify', () => {
    it('responde 400 quando o link não traz callbackURL', async () => {
      const token = await createEmailVerificationToken(env.BETTER_AUTH_SECRET ?? '', user.email);

      const response = await request.get(`/auth/email/verify?token=${token}`);

      expect(response.status).toBe(400);
    });

    it('verifica o email e redireciona para o callbackURL', async () => {
      const token = await createEmailVerificationToken(env.BETTER_AUTH_SECRET ?? '', user.email);

      const response = await request
        .get(`/auth/email/verify?token=${token}&callbackURL=http://localhost:3000/ok`)
        .redirects(0);

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('http://localhost:3000/ok');
    });
  });
});
