# AGENTS.md

Instruções para devs e IAs de código que trabalham neste repositório.
Arquitetura, convenções e guias por área estão em `CLAUDE.md` (em inglês); este arquivo não os repete.

Planejamento, especificações, backlog e arquivos de task ficam no repositório `revgas-planejamento`, não aqui.
Quando este texto citar `docs/invariantes.md` ou `plano/tasks/`, o caminho é relativo àquele repositório.

## Projeto e leitura inicial

Chatbot WhatsApp de revenda de gás, integrado ao RevGás e ao Chatwoot.
Stack: NestJS 11, Fastify, Redis, Drizzle/Postgres, Zod, Vitest e Biome.
Leia a task, seus arquivos, chamadores e testes antes de editar.
Ao alterar integração, leia o guia correspondente em `docs/guides/integrations/`.
Ao alterar eventos ou painel, leia `docs/guides/modules/metrics.md`.
Confira os guias no código; documentação não comprova comportamento.
Responda e escreva documentação em pt-BR.

## Ordem de trabalho

1. Identifique cenário, requisito e invariante; elimine ambiguidade comercial.
2. Localize o padrão existente, escreva a regressão e confirme que ela falha pelo motivo esperado.
3. Implemente a menor alteração que atende à task.
4. Rode as verificações aplicáveis e leia a saída; não declare comando que não executou.
5. Informe arquivos, resultados e limitações; pare ao cumprir o aceite.

Se faltar regra comercial ou contrato externo, pare a parte dependente e pergunte.
Melhoria fora da task vira sugestão, sem ampliar o escopo.
Combine com o responsável antes de editar arquivos compartilhados.

## Comandos

Gerenciador: pnpm 10.33.0 (campo `packageManager` do `package.json`). Todos os scripts abaixo existem no `package.json`.

| Objetivo | Comando | Observação |
|---|---|---|
| Verificação completa | `pnpm verify` | `pnpm lint && pnpm exec tsc --noEmit --incremental false && pnpm test`. Não inclui E2E |
| Lint | `pnpm lint` | Biome check |
| Tipos sem emissão | `pnpm exec tsc --noEmit --incremental false` | Não oculte erro de tipo |
| Unitários | `pnpm test` | Vitest run |
| Teste específico | `pnpm test src/modules/conversation/reminder.scheduler.spec.ts` | Sem `--` antes do caminho: com `--` o filtro é ignorado e todos os testes rodam |
| E2E | `pnpm test:e2e` | Precisa de Postgres e Redis; veja `CLAUDE.md` e `docs/guides/conventions/testing.md` |
| Build | `pnpm build` | Gera `dist`; não rode em tarefa somente leitura |
| Gerar migração | `pnpm db:generate` | Só em task que autorize alterar schema |
| Aplicar migração | `pnpm db:migrate` | Confirme alvo e autorização antes |

Estado verificado em 2026-11-27 no worktree da T-PLAT-01: `pnpm verify` passou, com lint sem erro, `tsc` sem erro e 129 arquivos de teste (1783 testes) passando.
Rode `pnpm verify` antes de abrir o PR.

CI, conforme o YAML:

- `.github/workflows/pull-request.yml` dispara em PR com base `integracao`, `develop`, `refactor`, `staging` ou `main`.
- `.github/workflows/tests.yml` tem os jobs `lint`, `typecheck`, `unit-tests` e `e2e-tests`.
- Essa configuração ainda não foi observada rodando no GitHub.

Checks live (`pnpm revgas:check`, `pnpm llm:check`, `pnpm rag:check`), simulador (`pnpm chat`) e servidor de desenvolvimento exigem autorização da task.

## Exemplos no código

Pontos de partida para achar o padrão antes de escrever. Números de linha mudam; se não baterem, procure pelo símbolo.

| Área | Onde olhar |
|---|---|
| Composição | `src/modules/conversation/flow-tools.ts:29` conecta serviços a FlowTools |
| Step | `src/modules/conversation/flow/steps/summary.step.ts:76` recebe estado e tools |
| Repositório | `src/modules/order/order.repository.ts:19` adapta domínio ao cliente |
| Integração | `src/integrations/revgas/hybrid-revgas.client.ts:12` implementa o contrato |
| Tabela Drizzle | `src/infra/database/schemas/metrics/bot-events.table.ts:3` |
| Migração da tabela | `drizzle/0003_sturdy_red_skull.sql:1`; preserve o histórico |
| Evento | `src/modules/metrics/contracts/metrics.types.ts:9` |
| Emissão do evento | `src/modules/conversation/reminder.scheduler.ts:101` |
| Persistência | `src/modules/metrics/bot-events.repository.ts:20` |
| Teste | `src/modules/conversation/reminder.scheduler.spec.ts:62`, envia e salva mantendo o TTL |
| Helper | `src/utils/cpf.ts:14`; procure antes de duplicar validação |
| Configuração | `src/config/env.ts`; leia o schema, nunca valores secretos |
| E2E | pasta `tests/` |

Mantenha dependências concretas na composição; steps recebem ferramentas.
Não importe Nest, Redis ou HTTP nos steps para contornar FlowTools.
Reaproveite DRIZZLE como em `src/modules/metrics/bot-events.repository.ts:14`.
Teste efeitos observáveis com fakes e fixtures claramente fictícias.
Não escreva comentários no código; explique na task ou no PR.
Commits: `tipo: descrição` em pt-BR, sem coautor de IA.
PR para `refactor`, revisado por outro dev.

## Invariantes

Critérios exigidos, inclusive onde o código ainda falha. A lista completa (INV-01 a INV-15), o estado atual e a task de cada uma ficam em `docs/invariantes.md` no `revgas-planejamento`.

- IA interpreta; regra determinística autoriza; humano resolve exceção.
- Venda depende de confirmação válida para o pedido apresentado.
- Não repita POST de resultado incerto; preserve a tentativa e peça humano.
- Preserve o checkpoint antes do envio (`src/modules/conversation/flow/steps/summary.step.ts:84`).
- Bot e lembrete não disputam a fila humana, mesmo antes de `active`.
- Preserve o retorno após a resolução (`src/modules/handoff/handoff.service.ts:247`).
- Lembrete não renova o TTL (`src/modules/conversation/conversation.repository.ts:77`).
- Métrica simulada deve ser distinguível de real; o contrato atual requer correção.
- CPF completo e validade de sete dias são decisões P0, ainda não o comportamento atual.
- Valide fronteiras; não remova guardas para fazer testes passarem.

## A IA nunca faz

- Abrir `.env` ou `segredos/`.
- Criar venda real, executar check live ou enviar mensagem real sem autorização específica.
- Apagar migração, banco ou dados; executar destruição sem confirmar o alvo.
- Colocar CPF, telefone, nome, endereço, token ou chave reais em log, evento, fixture ou documentação.
- Enviar dados pessoais ao LLM; teste a limpeza antes de ampliar interpretações.
- Tratar o modo hybrid como escrita real: clientes e vendas são fake (`src/integrations/revgas/hybrid-revgas.client.ts:25`).
- Instalar dependência ou mudar arquitetura sem necessidade e sem acordo do responsável.
- Declarar contrato externo comprovado apenas por fake.

## Critério de parada

Encerre com o cenário coberto, o escopo respeitado e as verificações com resultado.
Relate erro preexistente com arquivo e linha; não o esconda.
Se a correção exigir outra frente, coordene antes de ampliar o diff.
Deploy, migração de produção e venda de homologação exigem pedido específico.
