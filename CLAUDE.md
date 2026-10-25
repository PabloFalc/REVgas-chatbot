# CLAUDE.md

**revgas-chatbot** — a WhatsApp chatbot for a gas (GLP) reseller that walks the customer through
an order and creates the sale in the **RevGás ERP** via its public API. Stack: NestJS 11
(**Fastify**), Redis (ioredis), Drizzle ORM (Postgres), nestjs-zod/Zod, Pino, Biome, Vitest.

> The `docs/` guides are in Portuguese. Product context: `docs/project/specs.md`,
> `requisitos.md`, `funcionalidades.md`, `fluxo.md`. Index: `docs/README.md`.

## Commands

Package manager is **pnpm** — use it for everything.

| Task | Command |
| --- | --- |
| Install / build | `pnpm install` · `pnpm build` |
| Lint | `pnpm lint` · fix: `pnpm lint:fix` |
| Unit tests | `pnpm test` |
| E2e tests | `pnpm test:e2e` (needs `pnpm docker:init` for Postgres/Redis) |
| Dev | `pnpm start:dev` |
| Migrations | `pnpm db:generate` → `pnpm db:migrate` |
| Integration checks | `pnpm revgas:check` · `pnpm llm:check` |

**Commits:** `git commit` directly, conventional commits (`feat:`, `fix:`, `chore:`…).

## Architecture

```
src/
  config/       env.ts (dotenv + Zod, imported directly — no ConfigService) and Fastify plugins
  core/         global guards, filters, pipes, interceptors, decorators; erros/ (app errors at the
                root, one folder per integration: revgas/, whatsapp/, llm/, viacep/); services/email
  infra/        database (Drizzle + schemas), cache (Redis), health
  integrations/ revgas/, whatsapp/ (client + webhook), llm/, viacep/ — each with a fake mode
  utils/        pure helpers, no Nest/domain: mask, cpf, money, text, guards, safe-equal,
                parse-json, iso-datetime. Check here before writing a new helper.
  modules/      conversation/ (webhook + order flow), customer/, catalog/, order/, address/,
                assistant/ (LLM interpretation of free text), auth/ (on standby)
```

- `AppModule` = `CoreModule` + `RoutesModule` + `InfraModule`. `RoutesModule` imports only
  `ConversationModule`.
- `CoreModule` registers the global filters in the order `unexpected` → `betterAuth` → `drizzle`
  → `http` (Nest checks the last registered first, so the catch-all stays first), plus
  `rateLimit` and `zodValidationPipe`.
- **Auth is on standby**: no `/auth/*` routes and no global auth guard, so routes are public.
  Postgres is only used by Better Auth today. The WhatsApp webhook is validated by the Meta
  signature (`X-Hub-Signature-256`, needs `rawBody: true` in `main.ts`). To turn auth on and for
  its conventions, see `docs/guides/modules/auth.md`.

Dependency rules:

- `modules/` depends on `infra/` and `integrations/`, never the reverse. `integrations/` knows
  nothing about the domain and validates responses with Zod. Every client has a fake for tests.
- Module services never import SDKs or `integrations/` directly. They go through
  **repositories** (`*.repository.ts`, read/write data in Redis, Postgres or the RevGás API) or
  **gateways** (`*.gateway.ts`, outbound actions that store nothing, e.g. `messaging.gateway`).
  Only exception: `ConversationService` imports the webhook event **types** from
  `integrations/whatsapp/webhook/webhook.schemas`.
- Zod schemas live in the module that uses them (`*.schemas.ts`); in `modules/`, DTOs and domain
  types go in the module's `contracts/` folder. Drizzle tables live in `infra/database/schemas`.

### Conversation flow

- `ConversationService` handles each WhatsApp event: dedup, a per-phone lock, mark as read, run
  the flow, send the replies. Order state lives in Redis with a 15 min TTL.
  `ReminderScheduler` sends the 10 min idle reminder and must not renew that TTL
  (`saveOrderKeepingTtl`).
- The flow lives in `conversation/flow/`. Step files (`flow/steps/`) receive `FlowTools` and
  **never import Nest, Redis, integrations, services or repositories** — only flow files,
  `src/utils` and modules' `contracts/`. Test them with `createFakeTools`.
- `flow-tools.ts` is the only place that wires `FlowTools` to the real services. Keep new flow
  logic inside the steps.
- Behaviour rules (CPF check, reminder, repeat order) are in `docs/project/fluxo.md`.

## Conventions

- **No explanatory `//` comments in code.** (Comments in docs/markdown are fine.)
- **Secrets** (`REVGAS_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `LLM_API_KEY`)
  stay server-side — never in responses, logs or AI prompts.
- **LGPD:** mask customer CPF, phone and address in logs with `src/utils/mask`. CPF digits never
  go to logs, replies or AI prompts.
- **DTOs** are Zod schemas via `createZodDto`. Routes document and validate their output with
  `@ApiDoc(doc)` (`docs/guides/conventions/api-doc.md`).

## Testing

Vitest for unit (next to the code) and e2e (`tests/`, config `vitest.config.e2e.ts`). E2e uses
`createApp(extraImports)` from `tests/setup-e2e.ts`. Guide: `docs/guides/conventions/testing.md`.

## Area guides

Read the matching guide before touching an area:

- `docs/guides/integrations/` — `revgas.md` (modes, never retry POST), `whatsapp.md`,
  `llm.md`, `viacep.md`
- `docs/guides/modules/auth.md` · `docs/guides/services/email-service.md`
- `docs/guides/conventions/` — `environment.md` (env vars), `testing.md`, `api-doc.md`,
  `ci-cd.md` (develop/staging/main gitflow)
- `docs/security/SECURITY.md` — attack vectors, mitigations, secrets
