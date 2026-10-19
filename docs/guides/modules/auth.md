# Autenticação

A autenticação é provida pelo [Better Auth](https://www.better-auth.com/) e existe hoje só para
o **login do futuro painel da revenda** (F08). O cliente do WhatsApp **não** se autentica por
aqui — ele é identificado pelo telefone na conversa.

## Status: standby

O código da auth (e do [EmailService](../services/email-service.md), que só ela usa) está no
repositório, mas **desligado**:

- `RoutesModule` tem `imports: []` → **nenhuma rota `/auth/*` existe** (respondem `404`).
- O `AuthGuard` **não** está no `CoreModule`: ele é provider (`APP_GUARD`) do próprio
  `AuthModule`. Com a auth desligada **não há guard global** — as rotas são públicas por padrão.
  O futuro webhook do WhatsApp é validado pela assinatura do provedor, não por sessão.
- O `AppModule` não importa o `EmailModule` (quem importa é o `AuthModule`).
- `BETTER_AUTH_SECRET` é opcional. O `BetterAuthExceptionFilter` continua global no `CoreModule`
  (inofensivo enquanto nada lança `APIError`).
- O bot não depende de nada disso.

**Para ligar:**

1. Em `src/modules/routes.module.ts`, importe `authModule` de `./auth/auth.module` e coloque
   `...authModule` em `imports`. Isso traz o `AuthModule`, as rotas sob `/auth`, o `AuthGuard`
   global e o `EmailModule`.
2. Defina `BETTER_AUTH_SECRET` (mín. 32 chars) e, para email real, `RESEND_API_KEY`/`EMAIL_FROM`
   (ver [environment.md](../conventions/environment.md)).
3. Ao ligar, **toda** rota passa a exigir sessão por padrão: marque com `@Public()` as que não
   devem exigir (health já é; o webhook do WhatsApp também deve ser).

## Configuração

- **Email + senha** (`emailAndPassword`), com reset de senha, verificação de email sob demanda e
  troca de email — os emails saem pelo `EmailService` (Resend).
- **Só token Bearer** — plugin `bearer()`; **não há cookies**. O cliente envia
  `Authorization: Bearer <token>` em toda request autenticada.
- Sessões no **Postgres** (fonte de verdade) + **Redis** (`secondaryStorage`), com
  `cookieCache` **desligado**.

O NestJS expõe rotas finas que apenas delegam ao `auth.api.*`; toda a regra fica no singleton do
Better Auth. O handler HTTP nativo do Better Auth (`/api/auth/*`) **não** é montado — nossos
controllers envolvem o `auth.api.*` para manter guards, rate limit, validação e Swagger.

## Recorte: global vs método

No Better Auth a **sessão é unificada** — uma tabela `sessions`, qualquer que seja o método de
login. O provider só determina a linha na tabela `accounts`. Logo, **tudo que acontece depois
que existe uma sessão é global**; só a *entrada* (sign-in/sign-up) é específica do método:

- **Global** — ciclo de sessão (`SessionController`, `/auth/*`) e usuário
  (`UserController`, `/auth/me`). Nada aqui sabe o que é "email".
- **Método** — só o específico de email/senha (`EmailAuthController`, `/auth/email/*`).

## Peças

```
src/modules/auth/auth.ts                          # singleton Better Auth (config central)
src/modules/auth/auth.module.ts                   # registra os controllers sob /auth
src/modules/auth/session/session.controller.ts    # rotas globais /auth/*
src/modules/auth/user/user.controller.ts          # rotas globais /auth/me
src/modules/auth/email/email-auth.controller.ts   # rotas do método /auth/email/*
src/core/filters/better-auth/better-auth-exception.filter.ts  # APIError -> AppError
src/core/guards/auth.guard.ts                     # AuthGuard (APP_GUARD provido pelo AuthModule)
src/core/decorators/auth/*                        # @Public, @AllowAnonymous, @AllowUnverified, @Session
src/core/services/email/                          # EmailService (Resend) + templates
src/config/origins.ts                             # allowlist única de origens (CORS + trustedOrigins)
```

## Fluxo do token

1. `POST /auth/email/sign-up` ou `POST /auth/email/sign-in` devolve `{ token, user }`.
2. O cliente guarda o `token` e o envia em `Authorization: Bearer <token>`.
3. O `AuthGuard` repassa os headers ao `auth.api.getSession`, que resolve a sessão pelo token.
4. `POST /auth/sign-out` invalida a sessão do token atual.

> Como não há cookie, **não há CSRF** a tratar: nenhum browser anexa a credencial
> automaticamente. O custo é o token ficar exposto a **XSS** se o front o guardar em local
> legível por JS — cuidado no painel.

## AuthGuard (global quando ligado, fail-closed)

Registrado como `APP_GUARD` pelo `AuthModule` — só existe com a auth ligada; aí roda em **todas**
as rotas. A política é *fail-closed*: por padrão exige sessão **e** email verificado. A decisão,
em ordem:

```
1. @Public()                         → libera (não toca na sessão)
2. sessão válida                     → popula request.session
3. @AllowAnonymous()                 → libera (com ou sem sessão)
4. sem sessão                        → 401 UNAUTHORIZED ("Sessão inválida ou expirada")
5. email não verificado e sem
   @AllowUnverified()                → 403 FORBIDDEN ("Confirme seu email…")
6. caso contrário                    → libera
```

A sessão resolvida fica em `request.session` e é lida pelo decorator `@Session()`.

| Decorator | Efeito |
| --- | --- |
| `@Public()` | Desliga a auth por completo na rota/controller (ex.: health). |
| `@AllowAnonymous()` | Não exige login; se houver sessão, popula `request.session`. Usado em sign-in/sign-up, forget/reset-password e verify. |
| `@AllowUnverified()` | Exige login, mas dispensa o email verificado. Usado em get-session, sign-out, verify-email e verify. |
| `@Session()` | Param decorator: injeta `request.session` (`ISession \| null` em rotas anônimas). |

## Erros: `BetterAuthExceptionFilter`

Os controllers **não** usam `try/catch`: só delegam ao `auth.api.*`. O `APIError` lançado pelo
Better Auth é capturado pelo filtro global `src/core/filters/better-auth/better-auth-exception.filter.ts`
(`@Catch(APIError)`, registrado no `CoreModule` — fica global mesmo em standby) e mapeado para os `AppError` do projeto:

| status do Better Auth | AppError | HTTP |
| --- | --- | --- |
| 400 `BAD_REQUEST` | `BadRequestError` | 400 |
| 401 `UNAUTHORIZED` | `UnauthorizedError` | 401 |
| 403 `FORBIDDEN` | `ForbiddenError` | 403 |
| 404 `NOT_FOUND` | `NotFoundError` | 404 |
| 409 `CONFLICT` / 422 `UNPROCESSABLE_ENTITY` | `ConflictError` | 409 |
| (qualquer outro) | `InternalServerError` | 500 |

> O Better Auth emite **422** para "email já existe". Mapeamos 422 → `ConflictError` (**409**)
> de propósito: para o cliente, "já existe" é um conflito.

## Rotas

Só existem com a auth ligada. Todas exigem `Authorization: Bearer <token>` e email verificado,
exceto onde indicado ("anônimo" = sem token; "não verificado ok" = `@AllowUnverified`).

### Método — `/auth/email/*` (`EmailAuthController`)

| Método | Rota | Acesso | Resposta |
| --- | --- | --- | --- |
| POST | `/auth/email/sign-up` | anônimo, throttle estrito | `201 { token, user }`; `409` se já autenticado ou email já cadastrado. **Não** envia verificação |
| POST | `/auth/email/sign-in` | anônimo, throttle estrito | `200 { token, user }`; `409` se já autenticado |
| POST | `/auth/email/forget-password` | anônimo, throttle estrito | `200`; body `{ email, redirectTo }`; envia o email de reset |
| POST | `/auth/email/reset-password` | anônimo, throttle estrito | `200`; body `{ token, newPassword }` |
| POST | `/auth/email/change-password` | logado + verificado | `200`; exige a senha atual |
| POST | `/auth/email/verify-email` | logado, não verificado ok | `200`; body `{ callbackURL }`; (re)envia a verificação para o email da sessão |
| GET | `/auth/email/verify` | anônimo, não verificado ok | consome `?token=` e responde **302** para `callbackURL`; sem `callbackURL` ou fora da allowlist → `400` |

### Sessão — `/auth/*` (`SessionController`)

| Método | Rota | Acesso | Resposta |
| --- | --- | --- | --- |
| GET | `/auth/get-session` | logado, não verificado ok | `200` sessão atual (`session` + `user`) |
| POST | `/auth/sign-out` | logado, não verificado ok | `200`; encerra a sessão do token atual |
| GET | `/auth/sessions` | logado + verificado | `200` sessões ativas do usuário |
| POST | `/auth/sessions/revoke` | logado + verificado | `200`; revoga uma sessão pelo token (`{ token }`) |
| POST | `/auth/sessions/revoke-others` | logado + verificado | `200`; revoga as demais, mantendo a atual |

### Usuário — `/auth/me` (`UserController`)

| Método | Rota | Acesso | Resposta |
| --- | --- | --- | --- |
| PATCH | `/auth/me` | logado + verificado | `200 { status }`; atualiza `name`/`userName`/`image` |
| POST | `/auth/me/change-email` | logado + verificado | `200`; body `{ newEmail, callbackURL }`; `callbackURL` fora da allowlist → `400` |
| DELETE | `/auth/me` | logado + verificado | `200`; exclui a conta — body `{ password }` |

## Fluxos de email

O handler nativo do Better Auth não é montado, então os links dos emails são reescritos no
`auth.ts`:

- **Verificação** (`buildNativeVerifyUrl`): o link aponta para `GET /auth/email/verify` (em
  `BETTER_AUTH_URL`) levando `token` e o `callbackURL` informado no `verify-email`/`change-email`.
  A rota consome o token **sem cookies** (só marca o email como verificado) e redireciona (302)
  para o `callbackURL`. O sign-up **não** dispara verificação (`sendOnSignUp: false`); ela é sob
  demanda via `POST /auth/email/verify-email`.
- **Reset de senha** (`buildFrontendResetUrl`): o link aponta para a página do front passada em
  `redirectTo` no `forget-password`, com `?token=`. O front chama
  `POST /auth/email/reset-password { token, newPassword }`. O Better Auth valida o `redirectTo`
  contra o `trustedOrigins`.
- **Troca de email**: `user.changeEmail` reaproveita `buildNativeVerifyUrl` (aprovação pelo mesmo
  fluxo de verificação).

**Open redirect:** `GET /auth/email/verify` e `POST /auth/me/change-email` validam o
`callbackURL` com `isTrustedCallbackURL` (`auth.ts`), contra a mesma allowlist do CORS
(`src/config/origins.ts`). Em dev/test sem `CORS_ORIGIN` o modo é aberto e qualquer `callbackURL`
passa.

Os emails saem pelo `EmailService` — em `test` e em dev sem `EMAIL_DEV_REDIRECT` são só logados.
Ver [email-service.md](../services/email-service.md).

## Rate limiting

`RateLimitGuard` (global, `@nestjs/throttler` + Redis) aplica o throttler `default`
(50 req/min) a toda a API. `sign-in`, `sign-up`, `forget-password` e `reset-password` sobrepõem com
`@Throttle(STRICT_AUTH_THROTTLE)`
(10 req/min, bloqueio de 5 min). Em `NODE_ENV=test` os limites sobem para 9999. As constantes
vivem em `src/core/guards/rate-limit.guard.ts`.

## Origens e CORS

`src/config/origins.ts` deriva de `CORS_ORIGIN` (lista separada por vírgula) uma **allowlist
única**, usada pelo CORS do app (`cors.config.ts`) e pelo `trustedOrigins` do Better Auth.

| Ambiente | `CORS_ORIGIN` | Comportamento |
| --- | --- | --- |
| dev/test | vazio ou `*` | **aberto** — reflete a origem; `trustedOrigins = ['*']` |
| qualquer | lista definida | **estrito** — só as origens listadas |
| produção | vazio ou com `*` | **não sobe** — o schema de env (`.refine`) bloqueia no boot |

## Configuração do singleton (`auth.ts`)

| Config | O que faz | Por que importa |
| --- | --- | --- |
| `secret` (`BETTER_AUTH_SECRET`) | chave de assinatura dos tokens | comprometida = sessões forjáveis; ≥ 32 chars, fora do código |
| `baseURL` (`BETTER_AUTH_URL`) | URL base da API | base do link de verificação (`/auth/email/verify`) |
| `trustedOrigins` | allowlist de origens/callbacks | deriva de `CORS_ORIGIN` (ver acima) |
| `secondaryStorage` (Redis) | leitura/escrita da sessão no Redis | evita ir ao Postgres a cada request |
| `session.storeSessionInDatabase: true` | Postgres como fonte de verdade | sessão sobrevive a restart do Redis; preserva `session.id` |
| `session.cookieCache.enabled: false` | sem cache de sessão em cookie | coerente com o modo só-Bearer; sem estado obsoleto |
| `session.expiresIn` | validade da sessão (7 dias) | janela de exposição se um token vazar |
| `emailAndPassword` (+ `sendResetPassword`) | login por senha + email de reset | único método de entrada |
| `emailVerification.sendOnSignUp: false` | verificação só sob demanda | sign-up só cria conta + abre sessão |
| `user.changeEmail` | troca de email com verificação | link pelo mesmo fluxo de verify |
| `user.additionalFields.userName` | campo extra obrigatório e único | só o que está aqui chega em `session.user` |
| `user.deleteUser.enabled` | habilita `DELETE /auth/me` | — |
| `advanced.database.generateId: false` | IDs gerados pelo banco | mantém a estratégia de ID do schema |
| `plugins: [bearer()]` | autenticação por `Authorization: Bearer` | elimina cookies e CSRF |

## Adicionando outro método de login

Por causa do recorte global/método, um novo método é **puro acréscimo**: um controller novo
(ex.: `/auth/google/*`) registrado no `AuthModule`, sem tocar em `SessionController` nem
`UserController`. Não há plano para isso no escopo atual. Se for feito com OAuth, ative a
criptografia dos tokens OAuth do Better Auth — as colunas `access_token`/`refresh_token`/
`id_token` da tabela `accounts` são `text` sem criptografia em repouso (ver
[SECURITY.md](../../security/SECURITY.md)).
