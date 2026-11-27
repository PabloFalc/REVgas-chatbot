# revgas-chatbot

Chatbot de **WhatsApp** para uma revenda de gás (GLP): atende o cliente, confirma produto,
quantidade, endereço e forma de pagamento e **cria a venda direto no ERP RevGás** pela API
pública, sem atendente humano no caminho feliz. Dúvidas fora do menu são respondidas por IA com
base numa base de conhecimento (RAG), e pedido de atendente, emergência de gás ou falha ao criar a
venda levam a conversa para um atendente no Chatwoot.

Projeto de Extensão 2026.2 (ICEV) para a **Flow**. Escopo, requisitos e fluxo em
[`docs/project/`](./docs/project/specs.md).

**Stack:** NestJS 11 (adapter **Fastify**, Node), **Drizzle ORM** (Postgres), **Redis**
(ioredis — estado da conversa, rate limit), **nestjs-zod**/Zod (validação), **Pino** (logs),
**Biome** (lint/format), **Vitest** (unit + e2e).

> **Status (2026-11-23):** o fluxo de pedido está completo e testado: conversa, cliente,
> catálogo, pedido, endereço, assistente (IA), handoff e base de conhecimento, mais os clientes de
> RevGás, WhatsApp, ViaCEP, Chatwoot e LLM. Cada cliente externo tem modo `fake`, então tudo roda
> sem chaves. Pendente: F05 (status do pedido), painel da revenda e salvar vendas e conversas no Postgres (melhorias futuras, ver
> [funcionalidades.md](./docs/project/funcionalidades.md)).
>
> Limite conhecido: a chave RevGás disponível é só de leitura, então criar venda e cadastrar
> cliente só foram exercitados contra o mock (`REVGAS_MODE=fake`).

Verificação atual: 1772 testes unitários (128 arquivos) e 43 e2e (9 arquivos). Teste de carga
leve: 200 webhooks assinados, 10 concorrentes, p50 7 ms, p95 10 ms, 0 erros.

---

## Demo em 5 minutos

Roda sem nenhuma chave: RevGás, WhatsApp, Chatwoot e IA ficam em modo `fake`. Precisa de Docker
e Node 24.

```bash
pnpm install
cp .env.example .env     # deixe as chaves vazias
pnpm docker:init         # Postgres + Redis
pnpm db:migrate
pnpm chat                # simulador no terminal (faz o build antes)
```

O `pnpm chat` conversa com o bot sem WhatsApp. Botões e listas aparecem numerados (digite o número
para escolher). Detalhes e opções em [chat-simulator.md](./docs/guides/conventions/chat-simulator.md).

O que muda com cada configuração:

- **Sem `LLM_API_KEY` (padrão do `.env.example`):** o bot funciona só com botões e palavras-chave. Texto livre
  ("quero 2 P13 no pix") e dúvidas ficam sem IA.
- **Com `LLM_API_KEY`:** texto livre, leitura do nome, endereço digitado e respostas de dúvida pela
  base. Para as dúvidas, rode antes `pnpm kb:ingest` (indexa `knowledge/base/`; a base é fictícia,
  Revenda Chama Azul).
- **CEP:** o ViaCEP real é consultado (precisa de internet). Sem internet, digite o endereço
  completo.

Roteiro de conversa (o cliente começa sem cadastro, porque o RevGás fake inicia vazio):

| # | Você digita | O bot faz |
| --- | --- | --- |
| 1 | `oi` | Cumprimenta e pede o nome |
| 2 | `Maria Souza` | Pede o CPF |
| 3 | um CPF válido (só números) | Pede o endereço |
| 4 | um CEP real, ou o endereço completo | Monta o endereço e pede confirmação (botão); ao confirmar, cadastra o cliente |
| 5 | confirme o endereço, escolha o produto e a quantidade (de 1 a 10, limitada ao estoque) | Lista os produtos e pede a quantidade |
| 6 | escolha o pagamento; em dinheiro, informe o troco (maior que o total) | Mostra só as formas com preço |
| 7 | revise o resumo e toque em `Confirmar` | Cria a venda e devolve o número dela |

Depois, em qualquer etapa:

- `quero falar com atendente`: entra na fila do handoff. Sem Chatwoot, responde com o telefone da
  revenda (`STORE_PHONE`).
- `tô sentindo cheiro de gás`: texto fixo de segurança (Bombeiros, 193) e fila do atendente, sem IA.
- `/novo` no simulador apaga o pedido do telefone e recomeça.

### Ver métricas (opcional)

O bot grava eventos sem dados pessoais em `bot_events`, com retenção padrão de 180 dias.
Para consultar a demo, configure a senha local e o usuário de leitura conforme o
[guia de métricas](./docs/guides/modules/metrics.md), depois rode:

```sh
pnpm metabase:up
```

Abra http://localhost:3001 e use os [cards SQL](./docs/guides/metrics/sql/).
Ao terminar, rode `pnpm metabase:stop`. Os volumes preservam a configuração.

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

> O `.env` **não é versionado**. A `REVGAS_API_KEY` é solicitada ao suporte da RevGás e fica **só no servidor**.
> Referência de cada variável:
> [docs/guides/conventions/environment.md](./docs/guides/conventions/environment.md).

---

## Imagem de produção

O `Dockerfile` gera a imagem com o build, as dependências de produção (sem as de dev, então sem
`drizzle-kit`), `drizzle/` e `knowledge/`. O contêiner sobe a API (`node dist/main`) pelo
`docker/entrypoint.sh`. Passos de um deploy:

1. **Migrations.** Suba o contêiner com `RUN_MIGRATIONS=true`: o entrypoint roda
   `node dist/cli/migrate.js` antes da API e aborta o start se a migration falhar (o contêiner sai
   com erro, sem subir a versão nova sobre um banco no meio do caminho). Sem a variável, nada roda.
   Com mais de uma réplica, ligue a variável em uma só ou rode a migration à parte.
2. **Ingestão da base de conhecimento (manual).** Não roda no entrypoint: chama a API de embedding
   a cada start e, com `LLM_MODE=fake`, gravaria vetores simulados. Rode uma vez no contêiner, com as
   mesmas variáveis da API, quando a base ou o modelo de embedding mudar (precisa das migrations):

   ```bash
   node dist/cli/kb-ingest.js
   ```

3. **Conferir.** `GET /health` responde 200 com Postgres e Redis no ar e 503 se qualquer um cair. O
   `HEALTHCHECK` da imagem usa essa rota.

Em produção a validação de ambiente exige as variáveis da seção "Checklist de produção" de
[environment.md](./docs/guides/conventions/environment.md).

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
| Testes unitários | `pnpm test` (não precisa de `.env`) |
| Testes e2e | `pnpm test:e2e` (precisa de Postgres/Redis; ver [testing.md](./docs/guides/conventions/testing.md)) |
| Simulador de chat | `pnpm chat` (ver [chat-simulator.md](./docs/guides/conventions/chat-simulator.md)) |
| Indexar a base de conhecimento | `pnpm kb:ingest` (com `LLM_API_KEY` gera embeddings reais; sem ela usa vetores fake; ver [knowledge.md](./docs/guides/modules/knowledge.md)) |
| Checagens com serviço real | `pnpm revgas:check` · `pnpm llm:check` · `pnpm rag:check` (usam chaves reais; `rag:check` só em dev) |
| Migrations | `pnpm db:generate` → `pnpm db:migrate` |
| Migrations no build (sem drizzle-kit) | `pnpm db:migrate:prod` (roda `node dist/cli/migrate.js`) |
| Drizzle Studio | `pnpm db:studio` |
| Infra local | `pnpm docker:init` / `pnpm docker:stop` |
| Chatwoot local (handoff) | `pnpm chatwoot:prepare` (1ª vez) · `pnpm chatwoot:up` · `pnpm chatwoot:stop` (ver [chatwoot.md](./docs/guides/integrations/chatwoot.md)) |

> **Commits:** `git commit` direto, seguindo conventional commits (`feat:`, `fix:`, `chore:`…).

---

## Estrutura

```
src/
  config/         env (Zod), plugins (pino, swagger, cors, helmet, compress, under-pressure)
  core/           cross-cutting: guards, filters, interceptors, pipes, errors
  infra/          database (Drizzle + schemas), cache (Redis), health
  integrations/   clientes externos, cada um com modo fake: revgas, whatsapp, chatwoot, llm, viacep
  modules/        domínio: conversation (fluxo e webhooks), customer, catalog, order, address,
                  assistant (IA), handoff, knowledge (RAG)
  cli/            chat (simulador) e kb-ingest
  utils/          helpers (CPF, dinheiro, palavrões...)
knowledge/        base de conhecimento (Markdown) e perguntas de avaliação
scripts/          checagens com serviço real (revgas, llm, rag)
tests/            e2e (Vitest + supertest) e helpers
```

Camadas e regras de dependência: [specs.md](./docs/project/specs.md#estrutura-de-pastas).

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

- **[chatwoot.md](./docs/guides/integrations/chatwoot.md)** — handoff para atendente via Chatwoot:
  Docker local, configuração da caixa e dos tokens, webhook, estados do handoff e limitações.
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
