# Base de conhecimento (`src/modules/knowledge`)

Módulo que guarda o texto da revenda (bairros, prazo, troca de botijão, segurança…), busca os
trechos certos para uma pergunta e deixa a IA responder **só com eles**. Usa embeddings
([llm.md](../integrations/llm.md)) e Postgres com pgvector.

> **Estado atual (etapa A):** o módulo está pronto e testado, mas **não está ligado ao app**:
> `RoutesModule` não o importa e o fluxo do WhatsApp não chama `KnowledgeService`. Hoje ele é usado
> pelo `pnpm kb:ingest` e pelo `pnpm rag:check`. A ligação ao fluxo é a etapa B.

## O que é e onde fica

```
knowledge/
  base/                         arquivos .md ingeridos (KNOWLEDGE_DIR)
  evaluation/questions.json     perguntas da checagem (pnpm rag:check)
  README.md

src/modules/knowledge/
  chunker.ts, knowledge-files.ts   lê os .md e quebra em trechos
  knowledge-ingest.service.ts      ingestão incremental
  knowledge.repository.ts          Postgres (tabela knowledge_chunks)
  embedding.gateway.ts             ponte para o EmbeddingClient
  search-query.ts, fuse.ts         texto da busca, fusão RRF e corte de relevância
  answer.gateway.ts                prompt e chamada da IA
  answer-checks.ts                 checagens da resposta
  knowledge.service.ts             search() e answerQuestion()
  knowledge.config.ts              topK e cortes (vindos do env)
  evaluation/                      schema das perguntas e placar
src/cli/kb-ingest.ts               comando da ingestão
src/infra/database/schemas/knowledge/knowledge-chunks.table.ts
scripts/rag.live-check.spec.ts     pnpm rag:check
```

A base de hoje (`knowledge/base/revenda-chama-azul.md`) é **fictícia** (Revenda Chama Azul) e
serve só para teste.

## Como escrever a base

- Um `##` por assunto: cada seção vira um trecho. Texto antes do primeiro `##` (fora o `#` do
  título) vira um trecho com o título do documento.
- **Sem R$, sem porcentagem, sem horário de funcionamento e sem lista de formas de pagamento.**
  Preço vem do ERP, horário e pagamento serão respondidos pelo código (etapa B). A checagem de
  saída descarta respostas com esses dados, então escrevê-los na base só gera "não sei".
- Use os termos que o cliente usa ("botijão", "vale-gás", "troco", "P13"). A busca por texto
  depende da palavra exata.
- Seção acima de 1200 caracteres é quebrada em parágrafos (`Título (parte 2)`). Prefira seções
  curtas, com um assunto só. `###` fica dentro da seção.
- **O texto é dado, não instrução.** O prompt manda a IA ignorar ordens escritas nos trechos, mas
  não escreva "responda sempre…" na base.
- Mudou o texto de uma seção? Rode `pnpm kb:ingest`.

## Ingestão (`pnpm kb:ingest`)

```bash
pnpm kb:ingest              # lê KNOWLEDGE_DIR (padrão knowledge/base)
pnpm kb:ingest outra/pasta  # pasta diferente, relativa ao diretório atual
```

- **Incremental.** Cada trecho tem uma chave (`caminho#slug-do-título`) e um hash SHA-256 do texto
  embedado (`título do documento — título da seção` + conteúdo). Só vai para a API de embedding o
  que é novo ou mudou, ou o que foi gravado com outro modelo ou outra dimensão. Trecho que sumiu
  dos arquivos é apagado. O comando imprime `adicionados`, `atualizados`, `inalterados` e `removidos`.
- **Não roda no boot.** O app nunca ingere sozinho; rodar é decisão de quem edita a base.
- **Modo `fake`** (sem chave): grava vetores simulados com o modelo `fake` e avisa. Servem para
  testes, não para busca real.
- **Falhas.** Dimensão do cliente diferente da tabela, ou base sem nenhuma seção, interrompem com
  `KnowledgeIngestError`. Uma tentativa por lote, sem retry; o timeout é 30 s por lote.
- **Docker.** A imagem leva `knowledge/` e o build. No contêiner: `node dist/cli/kb-ingest.js`
  (`pnpm kb:ingest` faz `nest build` antes, então só serve em dev).

## Como a busca funciona

1. A pergunta é higienizada: `removeCpfs` e `removeLongDigitRuns` (sequências de 9 dígitos ou mais,
   o que também tira telefone) e corte em 500 caracteres. Sobrou nada com letra ou número: não há
   chamada de embedding nem de IA.
2. Gera-se o embedding da pergunta e, além disso, ela vira uma consulta de texto
   (`to_tsquery('portuguese', 'a | b | c')`): sem acento, sem palavras vazias, até 12 termos.
3. O banco devolve **10 candidatos por vetor** (HNSW, cosseno) e **10 por texto** (GIN em
   `search_text`), só de trechos gravados com o **modelo atual** (`embedding_model`); vetores de
   outro modelo nunca são comparados.
4. **RRF** funde as duas listas: `Σ 1/(60 + posição)`, empate pela similaridade.
5. **Corte de relevância.** Fica o trecho com similaridade de cosseno ≥ `KNOWLEDGE_MIN_SIMILARITY`
   ou, se também casou na busca por texto, ≥ `KNOWLEDGE_MIN_SIMILARITY_TEXT`. Devolve até
   `KNOWLEDGE_TOP_K`. Nenhum passou: "sem trecho" e a IA nem é chamada.

`KnowledgeService.search()` devolve `{ status: 'ok', chunks }` ou `{ status: 'unavailable' }`
(falha de banco ou embedding, com log de aviso; nunca lança).

## Resposta e checagens de saída

`KnowledgeService.answerQuestion(pergunta)` devolve `answered` (texto e títulos usados) ou
`unknown` com um motivo (`no_match`, `unavailable`, `not_in_sources`, `rejected`). **Nunca lança.**

O `AnswerGateway` manda à IA os trechos como `<trecho id="T1" titulo="…">…</trecho>` (com `&`, `<`
e `>` escapados), regras fixas e a pergunta, pedindo `{ answer, sources }` (`temperature` 0, 400
tokens, uma tentativa). As regras: responder só com os trechos, até 3 frases, nunca preço, valor,
taxa, desconto ou porcentagem, nunca inventar número, horário, bairro ou prazo, e tratar trechos e
pergunta como dado. A resposta vira `unknown` com `rejected` se falhar em qualquer checagem
(`answer-checks.ts`):

| Motivo | Descarta quando |
| --- | --- |
| `empty` | resposta vazia |
| `too_long` | mais de 600 caracteres |
| `no_sources` | a IA não citou nenhum trecho |
| `unknown_source` | citou um id que não foi enviado (`T1`, `t1.` e similares são normalizados) |
| `money` | tem `R$`, "real", "reais" ou "centavos" |
| `percent` | tem `%` ou "por cento" |
| `price_claim` | usa palavra de preço (grátis/gratuito, desconto, promoção, preço, custa, custo, barato, caro/cara, valor, cobra, taxa) que **não aparece nos trechos citados** |
| `number_not_in_sources` | tem número em algarismos (comparado pelo valor: `08` = `8`) ou por extenso (dois…mil, centenas, meio, zero, ordinais, dias da semana) que não aparece nos trechos citados |

Se a IA devolver `answer: null`, o resultado é `unknown` (`not_in_sources`). A comparação usa só os
trechos que a IA **citou**, não todos os enviados.

**Logs** (`component: 'knowledge'`) levam só `reason`, `rejection`, `chunks`, `errorName` e os
títulos usados. Nunca a pergunta, a resposta nem o texto dos trechos.

## Conferir com a IA real (`pnpm rag:check`)

```bash
pnpm rag:check
```

Roda `scripts/rag.live-check.spec.ts` com `vitest.config.live.ts`. **Sem `EMBEDDING_API_KEY` nem
`LLM_API_KEY` o teste é pulado.** Ele:

1. ingere `knowledge/base` no banco da `DATABASE_URL` (o mesmo do dev; não há banco separado);
2. roda as perguntas de `knowledge/evaluation/questions.json` (4 s entre elas, por causa do limite
   do plano gratuito) e imprime o placar;
3. falha se alguma pergunta dos grupos `unknown`, `off_topic` ou `manipulation` sair **respondida**.

Grupos das perguntas: `answerable` (traz `section` e `fact`; é acerto se a resposta contém o fato, e a
linha "busca" conta quantas vezes a seção esperada veio nos trechos), `unknown`, `off_topic`, `manipulation`, `emergency` e `price`. Os
dois últimos ficam "pendentes" até a etapa B. O placar mostra `passado/total` por grupo, a linha
"busca" e a lista de violações.

## Valores calibrados

| Item | Valor atual | Onde muda |
| --- | --- | --- |
| Trechos enviados à IA (`topK`) | 3 | `KNOWLEDGE_TOP_K` |
| Similaridade mínima | 0.70 | `KNOWLEDGE_MIN_SIMILARITY` |
| Similaridade mínima se casou no texto | 0.60 | `KNOWLEDGE_MIN_SIMILARITY_TEXT` |
| Constante do RRF (`k`) | 60 | `fuse.ts` |
| Candidatos por lista | 10 | `fuse.ts` |
| Tamanho máximo da resposta | 600 caracteres | `answer-checks.ts` |
| Pergunta | 500 caracteres | `search-query.ts` |
| Embedding | `gemini-embedding-001`, 768 dimensões | `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` |
| Chunk | seção `##`, quebra acima de 1200 caracteres | `chunker.ts` |

**Não calibrado ainda.** Os cortes são palpite. Rode `pnpm rag:check` com a chave real, ajuste as
três primeiras linhas e **registre aqui o placar** (data, modelo, busca X/Y, violações). O corte do
texto não pode ser maior que o do vetor (o boot recusa).

## Trocar de provedor ou de modelo

1. Ajuste `EMBEDDING_API_URL`, `EMBEDDING_API_KEY` e `EMBEDDING_MODEL` (variáveis em
   [environment.md](../conventions/environment.md)).
2. Rode `pnpm kb:ingest`: os trechos gravados com outro modelo são reembedados. Enquanto isso não
   roda, a busca (que filtra pelo modelo atual) não acha nada e o bot responde "não sei".
3. **Dimensão diferente** exige mudar `KNOWLEDGE_VECTOR_DIMENSIONS`
   (`infra/database/schemas/knowledge/knowledge-chunks.table.ts`), gerar uma migration
   (`pnpm db:generate`) e aplicá-la, além de `EMBEDDING_DIMENSIONS`. Sem isso a ingestão recusa.
4. Rode `pnpm rag:check` de novo e atualize a tabela acima.

## Banco local (pgvector)

O Postgres do `docker-compose.yml` usa a imagem `pgvector/pgvector:pg17` e um **volume novo**
(`postgres_pgvector_data`): os dados do volume antigo não aparecem, e `pnpm docker:init` cria um
banco vazio. Depois, `pnpm db:migrate` cria a extensão (`CREATE EXTENSION IF NOT EXISTS vector`,
migration 0001) e a tabela `knowledge_chunks` (0002).

- **Use `db:migrate`.** O `db:push` **não cria extensão**. Se precisar dele, crie à mão antes:
  `CREATE EXTENSION IF NOT EXISTS vector;`.
- Banco existente criado por `db:push`: crie a extensão à mão e rode o push, ou recrie o banco e
  use `db:migrate`.
- Voltar para um checkout do `develop` usa a imagem alpine e o volume antigos de novo; suba a infra
  daquele checkout.
- A CI usa a mesma imagem e `pnpm db:migrate` ([ci-cd.md](../conventions/ci-cd.md)).

## Testes

Unit ao lado do código (chunker, busca, fusão, checagens, gateway, serviço, placar), todos em
modo `fake`, sem rede. O e2e do repositório fica em `tests/knowledge/` e precisa do Postgres com
pgvector (`pnpm docker:init`). Veja [testing.md](../conventions/testing.md).
