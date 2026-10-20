# revgas-chatbot

Chatbot de **WhatsApp** para uma revenda de gás (GLP): atende o cliente, confirma produto,
quantidade, endereço e forma de pagamento e **cria a venda direto no ERP RevGás** pela API
pública — sem atendente humano no caminho feliz. Dúvidas fora do menu são respondidas por IA a
partir de um FAQ curto, e qualquer falha vira handoff para um atendente.

Projeto de Extensão 2026.2 (ICEV) para a **Flow**. Escopo, requisitos e fluxo em
[`docs/project/`](./docs/project/specs.md).

**Stack:** NestJS 11 (adapter **Fastify**, Node), **Drizzle ORM** (Postgres), **Redis**
(ioredis — estado da conversa, rate limit, sessões), **nestjs-zod**/Zod (validação),
**Better Auth** + **Resend** (login do painel por token Bearer — em **standby**), **Pino** (logs),
**Biome** (lint/format), **Vitest** (unit + e2e).

> **Status:** a base da API (config, segurança, health, infra de Postgres/Redis) está pronta. A
> auth do painel e o envio de email estão no código, mas em **standby** (desligados — ver
> [auth.md](./docs/guides/modules/auth.md#status-standby)). Os módulos do chatbot (conversa, cliente, catálogo, pedido, IA, handoff, métricas)
> e os clientes de RevGás, WhatsApp e LLM ainda serão implementados — ver a
> [estrutura planejada](./docs/project/specs.md#estrutura-de-pastas).

---

## Pré-requisitos

- **Node 24** e **pnpm 10.33.0** (o pnpm está fixado em `packageManager`).
- **Docker** + Docker Compose (Postgres e Redis locais).
- **Git** com os branches `develop`, `staging`, `main` (gitflow do projeto).

---

## Como rodar (local)

```bash
pnpm install            # instala dependências
cp .env.example .env    # configure as variáveis
pnpm docker:init        # sobe Postgres (revgas-pg) + Redis (revgas-redis)
pnpm db:migrate         # aplica as migrations Drizzle
pnpm start:dev          # API em http://localhost:3100 — docs em /docs
```

> O `.env` **não é versionado**. `BETTER_AUTH_SECRET` e as variáveis de email só são necessárias
> ao ligar a auth (gere o secret com `openssl rand -base64 32`, mín. 32 chars). A `REVGAS_API_KEY` é solicitada ao suporte da RevGás e fica **só no servidor**.
> Referência de cada variável:
> [docs/guides/conventions/environment.md](./docs/guides/conventions/environment.md).

---

## Scripts

| Tarefa | Comando |
| --- | --- |
| Instalar deps | `pnpm install` |
| Dev (watch) | `pnpm start:dev` |
| Build | `pnpm build` |
| Produção | `pnpm start:prod` |
| Lint · fix | `pnpm lint` · `pnpm lint:fix` |
| Format | `pnpm format` |
| Testes unitários | `pnpm test` |
| Testes e2e | `pnpm test:e2e` (precisa de Postgres/Redis — `pnpm docker:init`) |
| Migrations | `pnpm db:generate` → `pnpm db:migrate` |
| Drizzle Studio | `pnpm db:studio` |
| Infra local | `pnpm docker:init` / `pnpm docker:stop` |

> **Commits:** `git commit` direto, seguindo conventional commits (`feat:`, `fix:`, `chore:`…).

---

## Estrutura

Hoje:

```
src/
  config/      env (Zod), plugins (pino, swagger, cors, helmet, compress, under-pressure)
  core/        cross-cutting — guards, filters, interceptors, pipes, decorators, errors,
               services/email (EmailService + Resend, standby)
  infra/       database (Drizzle + schemas), cache (Redis), health
  modules/     domínio — auth/ (standby: não montado em routes.module.ts)
tests/         e2e (Vitest + supertest) e helpers
```

Planejado (ver [specs.md](./docs/project/specs.md#estrutura-de-pastas)): `modules/` ganha
`conversation`, `customer`, `catalog`, `order`, `assistant`, `handoff` e `metrics`; `integrations/` reúne
os clientes externos (`revgas`, `whatsapp`, `llm`).

---

## Documentação

Toda a documentação fica em **[`docs/`](./docs/README.md)**, em português. Leia o guia da área
antes de mexer no código correspondente.

### Projeto (`docs/project/`)

- **[specs.md](./docs/project/specs.md)** — especificação técnica (stack, estrutura, contratos de
  IA, integração RevGás, confiabilidade).
- **[requisitos.md](./docs/project/requisitos.md)** · **[funcionalidades.md](./docs/project/funcionalidades.md)**
  · **[fluxo.md](./docs/project/fluxo.md)** — o que o sistema garante, o que entrega e o fluxo da
  conversa.

### Guias

- **[auth.md](./docs/guides/modules/auth.md)** — autenticação do painel (Better Auth, só token
  Bearer): status standby e como ligar, `AuthGuard`, fluxos de email e rotas.
- **[email-service.md](./docs/guides/services/email-service.md)** — `EmailService` (Resend),
  standby, modo log-only em dev/test e templates.
- **[api-doc.md](./docs/guides/conventions/api-doc.md)** — o decorator `@ApiDoc` (Swagger +
  validação da resposta com Zod).
- **[environment.md](./docs/guides/conventions/environment.md)** — variáveis de ambiente e
  checklist de produção.
- **[testing.md](./docs/guides/conventions/testing.md)** — testes unit + e2e, `createApp`, helpers
  `deleteBy`/`signIn`/`signUpVerified`/`bearer` e armadilhas.
- **[ci-cd.md](./docs/guides/conventions/ci-cd.md)** — workflows do `.github` e o gitflow
  develop/staging/main.

### Segurança e arquitetura

- **[SECURITY.md](./docs/security/SECURITY.md)** — referência viva de segurança (API Key só no
  servidor, LGPD nos logs, CORS, rate limit…).
- **[infra-organization.md](./docs/architecture/infra-organization.md)** — organização da camada
  `src/infra`.

---

## Licença

Uso restrito ao projeto (`UNLICENSED`).
