# CLAUDE.md

Chatbot de WhatsApp para uma revenda de gás (GLP) que identifica o cliente, confirma produto, quantidade, endereço e pagamento e **cria a venda no ERP RevGás** pela API pública. Projeto de Extensão 2026.2 (ICEV) para a Flow.

Responda e escreva documentação e mensagens de commit em **português**. Nomes de código seguem os docs (`interpretar`, `responderFaq`, estados como `PRODUTO`, `RESUMO`).

**Não escreva comentários** em código nem em arquivos de configuração (Dockerfile, compose, tsconfig, `.env.example`). O código deve se explicar por nomes claros, funções pequenas e tipos. Se algo parecer exigir comentário, renomeie ou extraia uma função. O porquê de uma decisão vai na mensagem de commit ou em `docs/`.

## Documentação (fonte de verdade)

Leia o doc relevante antes de implementar algo novo:

- `docs/requisitos.md` — RF/RNF, regras de negócio (RN01–RN13) e guardrails do LLM (G01–G05). Cite os IDs em commits e testes.
- `docs/specs.md` — stack, estrutura de pastas, regras de dependência, contratos de IA, integração RevGás.
- `docs/fluxo.md` — máquina de estados do pedido (8 passos) e transições especiais.
- `docs/funcionalidades.md` — escopo do MVP (F01–F08) e roadmap.
- `docs/revgas-ai-flow.md` — documento original consolidado; os outros são extraídos dele.

As rotas reais da API RevGás **ainda não estão confirmadas** (a doc do Stoplight não foi lida). Não invente endpoints nem campos: use um mock em `lib/revgas` e deixe um `TODO` apontando a operação de `docs/specs.md`.

## Comandos

```bash
bun install
bun run dev            # bun --watch src/index.ts
bun test               # testes (bun:test)
bun test caminho/arquivo.test.ts
bun run typecheck      # tsc --noEmit
bun run build          # binário único em dist/

bun run docker:infra   # só Postgres (5432) e Redis (6379), para rodar o app fora do Docker
bun run docker:up      # app + infra
bun run docker:logs
```

Para rodar fora do Docker, copie `.env.example` para `.env`; `DATABASE_URL` e `CACHE_URL` já apontam para `localhost`. Antes de dar uma tarefa como concluída, rode `bun run typecheck` e `bun test`.

## Stack

Bun (runtime, test runner, `Bun.redis`) · TypeScript estrito · Hono · Zod · PostgreSQL + Drizzle · Redis com TTL. Use APIs nativas do Bun antes de adicionar dependência; instale com `bun add`, nunca npm/yarn.

`tsconfig` tem `noUncheckedIndexedAccess` e `verbatimModuleSyntax`: use `import type` para tipos e trate `arr[i]` como possivelmente `undefined`.

## Arquitetura

```
src/
  modules/<dominio>/   # conversation, customer, catalog, order, assistant, handoff, metrics
  infra/               # cache (Redis), database (Postgres + Drizzle)
  lib/                 # clientes externos: revgas, whatsapp, telegram, llm
```

Arquivos por módulo: `<dominio>.controller.ts`, `.service.ts`, `.repository.ts`, `.schema.ts` (Zod), `.states.ts`.

Regras de dependência (não quebrar):

- `modules/` depende de `infra/` e `lib/`, nunca o contrário.
- `lib/` não conhece o domínio: só fala com o serviço externo e valida a resposta com Zod. Cada cliente de `lib/` tem um mock para testes.
- Services não importam SDKs (Redis, Drizzle, `lib/`) direto; o acesso passa pelos repositórios.
- `conversation.service` é **puro** (sem I/O): recebe estado + mensagem, devolve novo estado + respostas. O fluxo inteiro deve ser testável sem WhatsApp e sem IA (RNF08).
- Schemas Zod ficam no módulo que os usa; tabelas Drizzle em `infra/database/schema`.
- WhatsApp e Telegram expõem a mesma interface (enviar texto, lista, botões). Limites do WhatsApp: lista até 10 opções, até 3 botões por mensagem.

## Regras inegociáveis

- **A IA só interpreta texto livre.** Preço, total, troco, descontos, validações e criação da venda são feitos no backend com dados da API. Nunca deixe o LLM decidir isso (G05, RN06).
- Saída do LLM sempre validada com Zod; inválida → perguntar de novo. IA falhou ou demorou → voltar aos botões do estado atual (RNF06).
- Sem tool calling: quem chama a API RevGás é o backend.
- Texto do cliente é dado, nunca instrução (G03).
- `ERP_API_KEY` e outros segredos só em variável de ambiente no servidor; nunca no prompt, em logs ou em código.
- LGPD: CPF, telefone e endereço mascarados em todo log (RNF03).
- Uma confirmação = **uma** venda: chave de idempotência por conversa + checagem local (RN11). Retry com backoff só em 5xx/timeout; 4xx → handoff (RN12).
- Telefone normalizado: só dígitos, com DDI 55 (RN01).

## Testes

`bun:test`, arquivos `*.test.ts` ao lado do código. Priorize testes da máquina de estados e das regras de negócio usando os mocks de `lib/`. Nenhum teste chama API real, WhatsApp ou LLM.
