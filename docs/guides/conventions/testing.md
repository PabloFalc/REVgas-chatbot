# Como escrever testes

O projeto usa **Vitest** para testes unitários e e2e. As duas suítes têm configs separadas:

| Suíte | Config | Onde ficam | O que sobe |
| --- | --- | --- | --- |
| Unit | `vitest.config.ts` | `src/**/*.spec.ts` | nada externo (mocks/DI em memória) |
| E2e | `vitest.config.e2e.ts` | `tests/**/*.e2e.spec.ts` | app real + Postgres + Redis |

Comandos:

| Tarefa | Comando |
| --- | --- |
| Unit | `pnpm test` |
| E2e | `pnpm test:e2e` (precisa de infra: `pnpm docker:init`) |
| Infra local | `pnpm docker:init` / `pnpm docker:stop` |

## Testes unitários

Para classes com dependências, monte um módulo de teste com `Test.createTestingModule` e
resolva o que precisar pelo container. Mocke as dependências externas — unit não toca em banco
nem rede.

```ts
import { Test } from '@nestjs/testing';
import { HealthService } from './health.service';
import { HealthRegistryService } from './services/registry.service';

describe('HealthService', () => {
  let service: HealthService;
  let registry: HealthRegistryService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [HealthService, HealthRegistryService],
    }).compile();

    service = module.get(HealthService);
    registry = module.get(HealthRegistryService);
  });

  it('deve retornar status ok quando todos os checks passam', async () => {
    registry.register({
      name: 'database',
      check: async () => ({ status: 'ok', responseTime: 5 }),
      onModuleInit: () => {},
    });

    const result = await service.check();

    expect(result.status).toBe('ok');
  });
});
```

O arquivo fica ao lado da unidade testada (`*.spec.ts` dentro de `src/`).

## Testes e2e

E2e sobe o app **inteiro** (Fastify + DI + plugins) e faz requisições HTTP de verdade via
`supertest`. O app é criado pelo helper `createApp` (`tests/setup-e2e.ts`), que já roda
`setupPlugins` e fica em `NODE_ENV=test`.

```ts
export async function createApp(extraImports: (Type | DynamicModule)[] = []): Promise<NestFastifyApplication>;
```

`createApp` monta um módulo de teste `[AppModule, ...extraImports]`. Isso permite testar módulos
que estão **fora** do `AppModule` — hoje, a auth em standby:

- `createApp()` → o app como roda hoje (sem auth, sem guard global).
- `createApp(authModule)` → o app com a auth ligada (`AuthModule` + rotas `/auth` + `AuthGuard`
  global + `EmailModule`). É o que a suíte `tests/auth/email/email-auth.e2e.spec.ts` usa.

`tests/app.e2e.spec.ts` cobre o app padrão: `GET /health` → `200` e
`POST /auth/email/sign-in` → `404` (garante que a auth continua em standby).

Em `NODE_ENV=test` os rate limits ficam relaxados (limite 9999), o envio de email é sempre
**log-only** e o logger fica `silent` (suba com `LOG_LEVEL=debug` ao depurar).

> ⚠️ Hoje o e2e roda contra o **mesmo banco do desenvolvimento** (a `DATABASE_URL` do `.env`).
> Por isso a limpeza é **escopada por suíte** (apaga só os dados daquele teste) — nunca um
> `TRUNCATE` global, que apagaria seus dados de dev.

Estrutura típica de uma suíte (ver `tests/auth/email/email-auth.e2e.spec.ts`):

```ts
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { users } from 'src/infra/database/schemas';
import supertest from 'supertest';
import { authModule } from 'src/modules/auth/auth.module';
import { bearer, signUpVerified } from '../../helpers/auth';
import { deleteBy } from '../../helpers/db';
import { createApp } from '../../setup-e2e';

describe('SessionController (e2e)', () => {
  let app: NestFastifyApplication;
  let request: ReturnType<typeof supertest>;
  let token: string;

  const user = {
    email: 'session@user.com',
    password: 'Test1234!',
    name: 'Session User',
    userName: 'sessionuser',
  };

  async function cleanup() {
    await deleteBy(users, users.email, [user.email]);
  }

  beforeAll(async () => {
    app = await createApp(authModule);
    request = supertest(app.getHttpServer());
    await cleanup();

    token = await signUpVerified(request, user);
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  }, 30000);

  it('retorna a sessão atual', async () => {
    const response = await request.get('/auth/get-session').set(bearer(token));

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(user.email);
  });
});
```

Pontos do padrão:

- `cleanup()` roda **no `beforeAll` e no `afterAll`**. O `beforeAll` garante slate limpo
  mesmo que um run anterior tenha morrido no meio (senão o sign-up daria `409`).
- `createApp(authModule)` liga a auth só nesta suíte.
- `request` é reaproveitado em toda a suíte; o `token` vem do `signUpVerified` e vai no header
  via `bearer(token)`.
- O `app.close()` no `afterAll` libera as conexões.

## Helpers principais

Ficam em `tests/helpers/`. Importe-os em vez de recriar a lógica.

### `deleteBy` — limpeza escopada (`tests/helpers/db.ts`)

```ts
export async function deleteBy<T extends Column>(
  table: PgTable,
  column: T,
  values: readonly T['_']['data'][],
): Promise<void>;
```

Apaga linhas de uma tabela onde uma coluna casa com qualquer um dos `values`.

```ts
await deleteBy(users, users.email, [user.email, other.email]);
```

- **A chave é a coluna, não a tabela.** Cada suíte limpa por `email` (ou outra coluna natural) —
  não por `id` —, então a coluna é parte do filtro.
- `<T extends Column>` amarra o tipo de `values` ao tipo da coluna (sem `any`).
- Sempre `inArray` (valor único = array de 1). Array vazio é no-op (guard interno), então não
  precisa de `if (values.length)` no chamador.
- **Cascade faz o resto.** `sessions` e `accounts` têm `onDelete: cascade`; apagar `users` já
  limpa essas tabelas.
- **Exceção: `verifications`.** Não tem FK (a coluna `value` guarda o id do user como texto
  solto), então precisa ser apagada explicitamente **antes** de `users` quando a suíte gera
  tokens (verify-email, reset de senha, change-email):

  ```ts
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, testEmails));

  await deleteBy(verifications, verifications.value, rows.map(row => row.id));
  await deleteBy(users, users.email, testEmails);
  ```

### `signIn`, `signUpVerified` e `bearer` — autenticação (`tests/helpers/auth.ts`)

Só fazem sentido em suítes criadas com `createApp(authModule)`.

```ts
export async function signIn(
  request: ReturnType<typeof supertest>,
  credentials: { email: string; password: string },
): Promise<string>;

export async function signUpVerified(
  request: ReturnType<typeof supertest>,
  account: { email: string; password: string; name: string; userName: string },
): Promise<string>;

export function bearer(token: string): { Authorization: string };
```

- `signIn` chama `POST /auth/email/sign-in` e devolve o **token** da sessão. O usuário precisa
  existir.
- `signUpVerified` faz **sign-up → marca `emailVerified = true` direto no banco → sign-in** e
  devolve o token. Use-o sempre que o teste precisar de rotas que exigem email verificado (a
  maioria).
- `bearer(token)` monta o header para o supertest: `request.get(...).set(bearer(token))`.

Não há cookies: tudo é token. Um token de usuário **não verificado** (sign-up/sign-in comum) só
passa em rotas `@AllowUnverified` (get-session, sign-out, verify-email); nas demais o guard
responde `403`.

## Armadilhas (gotchas)

### Identificadores únicos por suíte

O e2e roda **em série** (`fileParallelism: false`), mas todas as suítes compartilham o mesmo
banco. Como a limpeza é escopada (não global), **cada suíte deve usar emails/userNames
próprios** pra não colidir com outra. Reaproveitar o mesmo email entre suítes quebra dependendo
da ordem.

### Auth em standby → 404

`createApp()` sem argumentos **não** monta a auth: as rotas `/auth/*` respondem `404` e não há
guard global. Esqueceu o `authModule` numa suíte de auth? É isso.

### Já autenticado → 409

`sign-in` e `sign-up` respondem `409` quando a request já traz um token válido. Não reaproveite o
header `bearer(token)` nessas chamadas, a menos que seja exatamente isso que o teste verifica.

### WhatsApp sempre simulado

`vitest.config.e2e.ts` define `WHATSAPP_MODE=fake` (e um app secret/verify token de teste), então
o e2e nunca envia mensagem real, mesmo com token no `.env`. Para ver o que o bot respondeu, pegue o
simulador com `app.get(WHATSAPP_CLIENT)` (é um `FakeWhatsappClient`: `sent`, `read`, `clear()`) e
assine o corpo com `signPayload` (`src/integrations/whatsapp/webhook/signature.ts`). Use ids de
mensagem únicos: ids repetidos são ignorados por 24h no Redis. O webhook responde 200 antes de
processar, então espere o envio com `vi.waitFor(() => expect(whatsapp.sent).toHaveLength(1))`. Exemplo:
`tests/conversation/whatsapp-webhook.e2e.spec.ts`.

## Checklist para uma suíte e2e nova

1. Crie `tests/<área>/<algo>.e2e.spec.ts`.
2. Use `createApp` (com `authModule` se a suíte usa auth) + `supertest` no `beforeAll`.
3. Escolha emails/userNames **exclusivos** dessa suíte.
4. Escreva um `cleanup()` com `deleteBy` para cada tabela tocada (e `verifications` se houver
   tokens).
5. Chame `cleanup()` no `beforeAll` **e** no `afterAll`.
6. Obtenha o token com `signUpVerified` (ou `signIn`); envie com `bearer(token)`.
7. Feche o app com `app.close()` no `afterAll`.
8. Rode `pnpm docker:init` e depois `pnpm test:e2e`.
