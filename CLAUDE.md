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
| E2e tests | `pnpm test:e2e` (needs `pnpm docker:init` + `pnpm db:migrate` for Postgres/Redis) |
| Dev | `pnpm start:dev` |
| Migrations | `pnpm db:generate` → `pnpm db:migrate` |
| Integration checks | `pnpm revgas:check` · `pnpm llm:check` · `pnpm rag:check` |
| Knowledge base | `pnpm kb:ingest` (embeds `knowledge/base`; needs the migrations applied) |
| Local Chatwoot (Docker profile) | `pnpm chatwoot:prepare` · `pnpm chatwoot:up` · `pnpm chatwoot:stop` |
| Local metrics (Docker profile) | `pnpm metabase:up` · `pnpm metabase:stop` |
| Terminal chat simulator (instead of `start:dev`) | `pnpm chat` · `pnpm chat --phone 5586988887777 --revgas hybrid` |

**Commits:** `git commit` directly, conventional commits (`feat:`, `fix:`, `chore:`…).

## Architecture

```
src/
  config/       env.ts (dotenv + Zod, imported directly — no ConfigService) and Fastify plugins
  core/         global guards, filters, pipes, interceptors, decorators; erros/ (app errors at the
                root, one folder per integration: revgas/, whatsapp/, llm/, viacep/, chatwoot/); services/email
  infra/        database (Drizzle + schemas), cache (Redis), health
  integrations/ revgas/, whatsapp/ (client + webhook), chatwoot/ (client + webhook), llm/, viacep/ —
                each with a fake mode
  utils/        pure helpers, no Nest/domain: mask, cpf, money, text, guards, safe-equal,
                parse-json, iso-datetime. Check here before writing a new helper.
  modules/      conversation/ (webhook + order flow), customer/, catalog/, order/, address/,
                assistant/ (LLM interpretation of free text), handoff/ (queue to a human
                agent via Chatwoot), knowledge/ (RAG over the base, answers questions in the
                flow), auth/ (on standby)
  cli/          dev entry points run from dist/: kb-ingest, chat (terminal simulator, `pnpm chat`)
  server.ts     createServer() — the Fastify app shared by main.ts and `pnpm chat`
knowledge/      base/ (the .md files ingested by `pnpm kb:ingest`) and evaluation/ (rag:check questions)
```

- `AppModule` = `CoreModule` + `RoutesModule` + `InfraModule`. `RoutesModule` imports only
  `ConversationModule` (which imports `KnowledgeModule`), which also hosts the Chatwoot webhook
  route (`POST /webhooks/chatwoot`, validated by `X-Chatwoot-Signature`).
- `CoreModule` registers the global filters in the order `unexpected` → `betterAuth` → `drizzle`
  → `http` (Nest checks the last registered first, so the catch-all stays first), plus
  `rateLimit` and `zodValidationPipe`.
- **Auth is on standby**: no `/auth/*` routes and no global auth guard, so routes are public.
  Postgres runs with pgvector and is used by Better Auth and by the knowledge base (via
  `pnpm kb:ingest`). The WhatsApp webhook is validated by the Meta signature
  (`X-Hub-Signature-256`, needs `rawBody: true` in `main.ts`). To turn auth on and for its
  conventions, see `docs/guides/modules/auth.md`.

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
- **Secrets** (`REVGAS_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `LLM_API_KEY`,
  `EMBEDDING_API_KEY`, `CHATWOOT_API_TOKEN`, `CHATWOOT_BOT_TOKEN`, `CHATWOOT_WEBHOOK_SECRET`)
  stay server-side — never in responses, logs or AI prompts.
- **LGPD:** mask customer CPF, phone and address in logs with `src/utils/mask`. CPF digits never
  go to logs, replies, AI prompts or Chatwoot (`[CPF ocultado]`).
- **DTOs** are Zod schemas via `createZodDto`. Routes document and validate their output with
  `@ApiDoc(doc)` (`docs/guides/conventions/api-doc.md`).

## Testing

Vitest for unit (next to the code) and e2e (`tests/`, config `vitest.config.e2e.ts`). E2e uses
`createApp(extraImports)` from `tests/setup-e2e.ts`. Guide: `docs/guides/conventions/testing.md`.

## Area guides

Read the matching guide before touching an area:

- `docs/guides/integrations/` — `revgas.md` (modes, never retry POST), `whatsapp.md`,
  `llm.md`, `viacep.md`, `chatwoot.md` (human handoff desk, local Docker)
- `docs/guides/modules/metrics.md` — events, retention, read-only Metabase and SQL cards
- `docs/guides/modules/auth.md` · `docs/guides/modules/knowledge.md` · `docs/guides/services/email-service.md`
- `docs/guides/conventions/` — `environment.md` (env vars), `testing.md`, `chat-simulator.md`
  (`pnpm chat`), `api-doc.md`, `ci-cd.md` (develop/staging/main gitflow)
- `docs/security/SECURITY.md` — attack vectors, mitigations, secrets
