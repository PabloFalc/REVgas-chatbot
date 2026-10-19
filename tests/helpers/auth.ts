import { eq } from 'drizzle-orm';
import { db } from 'src/infra/database/drizzle-client';
import { users } from 'src/infra/database/schemas';
import type supertest from 'supertest';

type Credentials = { email: string; password: string };
type Account = Credentials & { name: string; userName: string };

export async function signIn(
  request: ReturnType<typeof supertest>,
  { email, password }: Credentials,
): Promise<string> {
  const response = await request.post('/auth/email/sign-in').send({ email, password });
  return response.body.token;
}

export async function signUpVerified(
  request: ReturnType<typeof supertest>,
  account: Account,
): Promise<string> {
  await request.post('/auth/email/sign-up').send(account);
  await db.update(users).set({ emailVerified: true }).where(eq(users.email, account.email));
  return signIn(request, account);
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
