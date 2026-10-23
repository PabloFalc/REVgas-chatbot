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
  config/       env (Zod), plugins (pino, swagger, cors, helmet, compress, under-pressure)
  core/         cross-cutting — guards, filters, interceptors, pipes, decorators,
                erros/ (app HTTP errors at the root; revgas/ and whatsapp/ hold each integration's
                error classes and mappers, kept separate), services/email (EmailService + Resend)
  infra/        database (Drizzle + schemas), cache (Redis), health
  integrations/ revgas/ — RevGás ERP client by API module (live/hybrid/fake modes, mock included)
                whatsapp/ — Meta Cloud API client (live/fake) + webhook (signature, parser)
                llm/ — OpenAI-compatible LLM client (Gemini; live/fake)
                viacep/ — CEP lookup client (http/fake)
  utils/        pure reusable helpers, no Nest/domain — mask (maskPhone, maskDocument, MASK),
                text (normalizeText, truncate), safe-equal, parse-json, guards (isRecord,
                isTimeoutError), iso-datetime. Check here before writing a new helper.
  modules/      domain — conversation/ (WhatsApp webhook at /webhooks/whatsapp + order flow in
                flow/: steps/, next-step, global-commands, messages, replies, testing/fake-tools),
                flow-tools.ts (binds FlowTools to the services, incl. `interpret`), customer/,
                catalog/, order/, address/ (repositories/services + contracts/), assistant/ (`interpret`: LLM free-text
                interpretation for the flow), auth/ (on standby, not wired in
                routes.module.ts)
```

- **App is assembled in `AppModule`**: `CoreModule`, `RoutesModule`, `InfraModule`. Config comes from `src/config/env.ts` (dotenv + Zod), imported directly — there is no ConfigModule/ConfigService.
- **`CoreModule`** registers the globals (`APP_*`): guard `rateLimit`, filters
  (`unexpected` → `betterAuth` → `drizzle` → `http`; Nest checks the last registered first, so the catch-all `unexpected` stays first), `zodValidationPipe`. Global behavior changes go here.
  It does **not** register `authGuard`.
- **Auth/email are on standby** (code present, switched off): `RoutesModule` imports only
  `ConversationModule`, so no `/auth/*` routes exist (404) and there is **no global auth guard** —
  routes are public by default (the WhatsApp webhook is validated by the Meta signature,
  `X-Hub-Signature-256`, which needs `rawBody: true` in `main.ts`). `AuthModule`
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
  modules/     conversation, customer, catalog, order, assistant, metrics
  infra/       cache (conversation state with TTL), database (Postgres + Drizzle)
  integrations/ revgas, whatsapp, llm — clients for external services
```

Dependency rules:

- `modules/` depends on `infra/` and `integrations/`, never the reverse.
- `integrations/` knows nothing about the domain: it talks to the external service and validates responses with Zod.
- Module services don't import SDKs (Redis, Drizzle, `integrations/`) directly. Access goes through:
  - **repositories** (`*.repository.ts`) — read/write data: Redis, Postgres, or records in an external
    API (e.g. RevGás customers/sales). Example: `conversation.repository` (message dedup, order state).
  - **gateways** (`*.gateway.ts`) — outbound actions that store nothing (send a message, notify).
    Example: `messaging.gateway` (sends replies via `WHATSAPP_CLIENT`).
  - Known exception: `ConversationService` imports the WhatsApp webhook event **types**
    (`integrations/whatsapp/webhook/webhook.schemas`) — types only, never clients.
- Every `integrations/` client has a mock for tests.
- `ConversationService` handles each WhatsApp event (dedup via repository, per-phone lock with
  owner and 120 s TTL, mark as read, run the flow, send via gateway, logging). The order state lives
  in Redis with a 15 min TTL. Returning customers confirm the first 3 CPF digits before seeing
  their data (verified 15 days per phone + RevGás customer id; 3 wrong attempts block the phone
  for 1 h). `ReminderScheduler` sweeps every 30 s (off in `NODE_ENV=test`) and sends an idle
  reminder at 10 min without a customer message, once per idle period, never in `creatingSale`; it
  does not renew the order TTL (`saveOrderKeepingTtl`). The flow itself is in
  `conversation/flow/`: step files in `flow/steps/` receive `FlowTools` and **never import Nest, Redis, integrations, services or
  repositories** (only flow files, `src/utils` and modules' `contracts/`), so they are testable
  with `createFakeTools` (no WhatsApp, AI or DB — RNF08). `flow-tools.ts` is the only place that
  wires `FlowTools` to the real services. Keep new flow logic inside the steps.
- Zod schemas live in the module that uses them (`*.schemas.ts`); in `modules/`, input/output shapes
  (DTOs and domain types) go in the module's `contracts/` folder. Drizzle tables live in
  `infra/database/schemas`.

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
- **Secrets:** `REVGAS_API_KEY`, `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_APP_SECRET` and `LLM_API_KEY` stay server-side only (RNF02) — never in responses, logs or AI
  prompts. `STORE_PHONE`/`STORE_CITY`/`STORE_STATE` are the reseller's contact and default address region. Customer CPF/phone/address must be masked in logs (LGPD) — use `src/utils/mask`.

## Documentation

Index: `docs/README.md`. Area guides (read before touching the matching area):

- `docs/project/specs.md` — technical spec (stack, planned structure, AI contracts, RevGás API integration)
- `docs/guides/modules/auth.md` — auth (standby + how to turn on), bearer-only, `AuthGuard`, email flows, routes
- `docs/guides/integrations/revgas.md` — RevGás client (`src/integrations/revgas`): modes, hybrid routing, key permissions, errors, never retry POST, `pnpm revgas:check`
- `docs/guides/integrations/whatsapp.md` — WhatsApp Cloud API (`src/integrations/whatsapp`) + webhook (`src/modules/conversation`): modes, Meta setup step by step, local tunnel, signature, dedup, message limits, errors
- `docs/guides/integrations/viacep.md` — ViaCEP client (`src/integrations/viacep`): modes (live/fake), address lookup by CEP, errors
- `docs/guides/integrations/llm.md` — LLM client (`src/integrations/llm`): modes, getting the key, how a module consumes it, errors, `FakeLlmClient`, switching provider, `pnpm llm:check`
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
