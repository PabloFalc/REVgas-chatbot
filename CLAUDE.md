# CLAUDE.md

**revgas-chatbot** — a WhatsApp chatbot for a gas (GLP) reseller that walks the customer through
an order and creates the sale in the **RevGás ERP** via its public API (Projeto de Extensão
2026.2, ICEV, client Flow). Stack: NestJS 11 (**Fastify** adapter, Node), Drizzle ORM (Postgres),
Redis (ioredis), nestjs-zod/Zod (validation/DTOs), Better Auth + Resend (reseller panel login,
bearer token — **on standby**), Pino (logging), Biome (lint/format), Vitest (unit + e2e).

> The `docs/` guides are written in Portuguese — this file points to them by path. Product
> context: `docs/project/specs.md`, `requisitos.md`, `funcionalidades.md`, `fluxo.md`.

## Commands

The project's package manager is **pnpm** (`pnpm@10.33.0`). Use `pnpm` for everything.

| Task | Command |
| --- | --- |
| Install deps | `pnpm install` |
| Build | `pnpm build` |
| Lint | `pnpm lint` · fix: `pnpm lint:fix` |
| Unit tests | `pnpm test` |
| E2e tests | `pnpm test:e2e` (needs Postgres/Redis up — `pnpm docker:init`) |
| Dev | `pnpm start:dev` |
| Migrations | `pnpm db:generate` → `pnpm db:migrate` (Drizzle Kit) |
| Local infra | `pnpm docker:init` / `pnpm docker:stop` |

**Commits:** use `git commit` directly with conventional commits (`feat:`, `fix:`, `chore:`…).

## Architecture

Current:

```
src/
  config/      env (Zod), plugins (pino, swagger, cors, helmet, compress, under-pressure)
  core/        cross-cutting — guards, filters, interceptors, pipes, decorators, errors,
               services/email (EmailService + Resend)
  infra/       database (Drizzle + schemas), cache (Redis), health
  integrations/ revgas/ — RevGás ERP client by API module (live/hybrid/fake modes, mock included)
  modules/     domain — auth/ (on standby, not wired in routes.module.ts)
```

- **App is assembled in `AppModule`**: `CoreModule`, `RoutesModule`, `InfraModule`. Config comes from `src/config/env.ts` (dotenv + Zod), imported directly — there is no ConfigModule/ConfigService.
- **`CoreModule`** registers the globals (`APP_*`): guard `rateLimit`, filters
  (`unexpected` → `betterAuth` → `drizzle` → `http`; Nest checks the last registered first, so the catch-all `unexpected` stays first), `zodValidationPipe`. Global behavior changes go here.
  It does **not** register `authGuard`.
- **Auth/email are on standby** (code present, switched off): `RoutesModule` has `imports: []`,
  so no `/auth/*` routes exist (404) and there is **no global auth guard** — routes are public by
  default (the future WhatsApp webhook is validated by the provider's signature). `AuthModule`
  itself provides the `AuthGuard` (`APP_GUARD`) and imports `EmailModule`; `AppModule` does not
  import `EmailModule`. **To turn it on:** add `...authModule` (from `./auth/auth.module`) to
  `RoutesModule.imports` and set `BETTER_AUTH_SECRET`. Then every route requires a session by
  default — mark public ones with `@Public()`. See `docs/guides/modules/auth.md`.
- **Better Auth is a module singleton** (`src/modules/auth/auth.ts`), created outside the DI
  container. The native HTTP handler (`/api/auth/*`) is **not** mounted; controllers wrap
  `auth.api.*` in our own typed routes (keeps guards/rate-limit/validation/Swagger).

Planned (from `docs/project/specs.md`, names still to be validated with the group):

```
src/
  modules/     conversation, customer, catalog, order, assistant, handoff, metrics
  infra/       cache (conversation state with TTL), database (Postgres + Drizzle)
  integrations/ revgas, whatsapp, llm — clients for external services
```

Dependency rules:

- `modules/` depends on `infra/` and `integrations/`, never the reverse.
- `integrations/` knows nothing about the domain: it talks to the external service and validates responses with Zod.
- Module services don't import SDKs (Redis, Drizzle, `integrations/`) directly — that goes through repositories.
- Every `integrations/` client has a mock for tests.
- `conversation.service` does no I/O: (state, message) → (new state, replies), testable without WhatsApp or AI.
- Zod schemas live in the module that uses them (`*.schema.ts`); Drizzle tables live in `infra/database/schemas`.

## Conventions (important)

- **No explanatory `//` comments in code.** Do not add inline comments; the code should speak
  for itself. (Comments in docs/markdown are fine.)
- **Auth is bearer-token only** (Better Auth `bearer()` plugin, no cookies, `cookieCache` off).
  Clients send `Authorization: Bearer <token>`; sign-in/sign-up return `{ token, user }`. When on,
  the `AuthGuard` is fail-closed: `@Public()` skips it, `@AllowAnonymous()` lets requests through
  without a session (but attaches it if present), no session → 401, session without verified
  email → 403 unless the route has `@AllowUnverified()` (get-session, sign-out, verify-email,
  verify). Email flows (verify, reset password, change email) go through `EmailService`.
- **Routes that wrap `auth.api.*`**: no `try/catch` — the global `BetterAuthExceptionFilter`
  translates Better Auth's `APIError` → the project's `AppError`s. Just delegate to `auth.api.*`
  with the request headers.
- **Response docs/validation** via `@ApiDoc(doc)` — generates Swagger and validates the output
  with Zod (and injects `@HttpCode`). `security` only supports `{ bearer: true }`. See
  `docs/guides/conventions/api-doc.md`.
- **DTOs** are Zod schemas via `nestjs-zod` (`createZodDto`), validated by the global `zodValidationPipe`.
- **Auth split:** global at `/auth/*` (session) and `/auth/me/*` (user); method at `/auth/email/*`.
- **Secrets:** `REVGAS_API_KEY` stays server-side only (RNF02) — never in responses, logs or AI
  prompts. Customer CPF/phone/address must be masked in logs (LGPD).

## Documentation

Index: `docs/README.md`. Area guides (read before touching the matching area):

- `docs/project/specs.md` — technical spec (stack, planned structure, AI contracts, RevGás API integration)
- `docs/guides/modules/auth.md` — auth (standby + how to turn on), bearer-only, `AuthGuard`, email flows, routes
- `docs/guides/integrations/revgas.md` — RevGás client (`src/integrations/revgas`): modes, hybrid routing, key permissions, errors, never retry POST, `pnpm revgas:check`
- `docs/guides/services/email-service.md` — `EmailService` (Resend), standby, log-only in dev/test
- `docs/guides/conventions/api-doc.md` — the `@ApiDoc` decorator
- `docs/guides/conventions/environment.md` — env vars (purpose, requiredness, defaults, consequences)
- `docs/guides/conventions/testing.md` — writing tests (unit + e2e), `createApp(extraImports)`, the `deleteBy`/`signIn`/`signUpVerified`/`bearer` helpers, scoped cleanup and e2e gotchas
- `docs/guides/conventions/ci-cd.md` — the `.github` workflows and the develop/staging/main gitflow
- `docs/security/SECURITY.md` — living security reference (attack vectors, mitigations, secrets)
- `docs/architecture/` — architecture notes

## Testing

- **Unit + e2e with Vitest** (e2e in `tests/`, own config `vitest.config.e2e.ts`).
- E2e needs Postgres/Redis (`pnpm docker:init`). In `NODE_ENV=test` rate limits are relaxed,
  email is log-only and the logger is silent.
- `createApp(extraImports = [])` (`tests/setup-e2e.ts`) wraps `[AppModule, ...extraImports]`;
  auth suites use `createApp(authModule)` since auth is on standby. `tests/app.e2e.spec.ts`
  asserts `/health` → 200 and `/auth/email/sign-in` → 404.
- E2e pattern: cleanup scoped per suite with `deleteBy`; authenticate with
  `signUpVerified(request, account)` (or `signIn`) → token, then `.set(bearer(token))`.
- Full guide: `docs/guides/conventions/testing.md`.
