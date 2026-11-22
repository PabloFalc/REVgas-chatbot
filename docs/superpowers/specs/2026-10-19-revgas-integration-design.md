# Design — Integração com a API RevGás (`lib/revgas`)

> Atualização (2026-10-19): código movido para `src/integrations/revgas`, organizado por módulos (`shared/`, `customers/`, `sales/`…), contrato agrupado (`revgas.sales.create`).

Data: 2026-10-19 · Status: rascunho para aprovação

## Intenção

Primeira peça do desenvolvimento: a camada que conversa com o ERP RevGás. O chatbot inteiro depende dela para catálogo, preço, cliente e criação da venda (RF02–RF09). Ela precisa existir antes dos módulos de domínio (`catalog`, `customer`, `order`) para que eles sejam escritos contra contratos estáveis.

O que torna este trabalho particular é a **chave disponível ser só de leitura e sem acesso a clientes**, e não haver outra chave nem ambiente de homologação utilizável. A decisão do grupo foi: **leituras liberadas vão para a API real; o resto é simulado** com dados no formato real. A demo para a Flow roda assim.

## Objetivos

- Contratos tipados (TypeScript + Zod) para todas as operações RevGás que o fluxo usa.
- Conexão real e confiável para as leituras que a chave permite.
- Simulador (fake) com estado para as operações sem permissão, no mesmo contrato, de modo que trocar para a API real depois seja simples: a API inteira muda com `REVGAS_MODE=live`; uma operação isolada exige editar o roteamento em `HybridRevgasClient` (mudança pequena, com teste).
- Erros da RevGás traduzidos para tipos próprios que o domínio consiga tratar (ex.: decidir handoff).
- Respeitar o rate limit global de 1 req/s sem que o domínio precise pensar nisso.

## Não objetivos

- Módulos de domínio (`catalog`, `customer`, `order`), resolução de preço a partir dos acordos, cache do catálogo no Redis, máquina de estados, WhatsApp, IA. Vêm em designs seguintes.
- Rate limit distribuído entre várias instâncias (o MVP roda em uma instância).
- Chamar a API real no CI.

## Anti-objetivos (falha mesmo se "funcionar")

- A chave aparecer em log, resposta, erro ou mensagem de exceção (RNF02).
- CPF, telefone ou endereço de cliente em log sem máscara (RNF03).
- Uma venda duplicada por retry automático de `POST /sales` (RNF04).
- Schema Zod estrito que quebre quando a RevGás devolver campo novo ou valor de enum novo (já aconteceu: `GAS_DO_POVO`).
- O domínio saber se uma operação foi real ou simulada.

## Fatos da API que restringem o design

Conferidos na spec privada (`docs/project/private/`) e com a chave real em 2026-10-19. Resumo em `docs/project/specs.md`.

- Base `https://api.revgas.com/v1`; header `Authorization: <chave>` (sem `Bearer`). Homologação marcada "Não utilizar".
- Limite global de 1 req/s → 429. Latência observada 360–720 ms.
- Paginação `page`/`page_size` (máx. 100); resposta `{ data, pagination: { page, page_size, count, total_count, has_next } }`.
- Erros padrão: 400 `{message}`, 401, 402 (chave bloqueada por pagamento), 403, 409 (lock → pode repetir; duplicado → `data[].value_id`), 422 `{data:[{field,message}], message}`, 500.
- Nenhum schema declara campos obrigatórios. Respostas reais trazem campos não documentados.
- Sem idempotência em `POST /sales`.
- Permissões da chave atual:

| Operação | Rota | Na chave atual |
| --- | --- | --- |
| Listar estabelecimentos | `GET /establishments` | ✅ real |
| Listar produtos | `GET /products` | ✅ real |
| Listar acordos (preço) | `GET /deals` | ✅ real |
| Listar vendas | `GET /sales` | ✅ real |
| Detalhar venda | `GET /sales/{id}` | ✅ real (presumido, mesma permissão de listar) |
| Buscar clientes | `GET /customers` | ❌ 403 → simulado |
| Cadastrar / alterar cliente | `POST /customers`, `PUT /customers/{id}` | ❌ → simulado |
| Listar formas de pagamento | `GET /payment-types` | ❌ 403 → simulado |
| Criar venda | `POST /sales` | ❌ sem permissão → simulado |
| Cancelar venda | `PUT /sales/{id}/cancel` | ❌ (presumido) → simulado |

## Decisões tomadas com o grupo

1. **Modo híbrido**: leituras liberadas = API real; POST, PUT e leituras sem acesso = dados simulados. Vale para desenvolvimento e para a demo.
2. **Só uma chave, só um estabelecimento** ("RevGás Técnico", id 2580, provavelmente conta de teste).
3. **Preço vem dos acordos** (`/deals`), que são sempre por forma de pagamento (tipos `PAYMENT_TYPE`, `TAG`, `CUSTOMER`). A resolução do preço é do domínio, não desta camada.

## Desenho

### Onde fica

```
src/lib/revgas/
  revgas.module.ts          # provê REVGAS_CLIENT conforme o modo
  revgas.client.ts          # interface RevgasClient + token REVGAS_CLIENT
  revgas.schemas.ts         # schemas Zod de request/response (pode ser dividido por recurso)
  revgas.errors.ts          # hierarquia de erros
  http/                     # cliente HTTP real (fetch, fila 1 req/s, retry, logs)
  fake/                     # simulador com estado + seeds
  hybrid.client.ts          # roteia operação a operação entre http e fake
```

`lib/` não importa nada de `modules/`. Ninguém consome o módulo ainda; ele fica pronto para os módulos de domínio.

### Contrato (`RevgasClient`)

Operações (nomes finais ficam a critério do builder, mantendo o espírito):

- `listEstablishments()`
- `listProducts({ inactive?, description?, page?, pageSize? })`
- `listDeals({ productId?, customerId?, tagId?, paymentType?, page?, pageSize? })`
- `listAllDeals(filtros)` — percorre todas as páginas respeitando o rate limit
- `listPaymentTypes()`
- `findCustomersByPhone(phone)` / `getCustomer(id)` / `createCustomer(input)` / `updateCustomer(id, input)`
- `createSale(input)` / `getSale(id)` / `listSales({ customerId?, channel?, from?, to?, status?, page?, pageSize? })` / `cancelSale(id, motiveId?)`

O `establishment_id` é injetado pelo cliente a partir da config, não passado pelo domínio.

Tipos de entrada e saída mantêm os **nomes de campo da RevGás** (snake_case, como na API) — a tradução para o vocabulário do domínio é responsabilidade dos repositórios dos módulos. Valores monetários ficam como `number`, como a API devolve.

### Schemas

- Objetos de resposta com `z.looseObject` (ou equivalente): campos conhecidos tipados, extras preservados.
- Campos opcionais por padrão, já que a spec não declara obrigatórios; só `id` e o mínimo que o domínio precisa são exigidos.
- Enums que a RevGás já mostrou expandir (`payment_type`, status de venda) aceitam string desconhecida sem quebrar, preservando o valor.
- Inconsistências conhecidas: filtro de status usa `WARN`, resposta usa `WARNING`.
- Resposta que falha na validação vira `RevgasResponseError` (com o caminho do campo, sem dados pessoais), não um crash genérico.

### Cliente HTTP real

- `fetch` nativo do Node 24, sem dependência nova.
- **Fila serial** com espaçamento mínimo configurável (padrão 1.000 ms + folga) entre o início de chamadas.
- Timeout por chamada (`REVGAS_TIMEOUT_MS`).
- **Retry** com backoff exponencial e limite de tentativas apenas em: 429, 5xx, 409 com mensagem de lock, timeout e erro de rede — **e nunca em `POST`**. `PUT` também não repete (o único PUT de interesse muda estado).
- **Log** de toda chamada (RNF05): método, rota, status, duração, tentativa. Query e corpo passam por máscara (telefone, CPF, endereço); a chave nunca é logada. Usa o logger Pino do projeto.

### Erros

Hierarquia própria (`RevgasError` com `status` e `kind`), não os `AppError` HTTP do projeto — quem decide o que vira resposta ou handoff é o domínio:

| Situação | Erro |
| --- | --- |
| 401 | `RevgasUnauthorizedError` |
| 402 | `RevgasBlockedError` |
| 403 | `RevgasForbiddenError` |
| 404 | `RevgasNotFoundError` |
| 400 / 422 | `RevgasValidationError` (com `fields[]`) |
| 409 duplicado | `RevgasDuplicateError` (com `existingId` de `value_id`) |
| 409 lock (após retries) / 429 / 5xx / timeout / rede (GET); 429 e lock 409 em POST/PUT | `RevgasUnavailableError` |
| POST/PUT com 5xx, timeout ou rede | `RevgasUnknownOutcomeError` (resultado desconhecido) |
| resposta fora do schema | `RevgasResponseError` |

`createSale` com timeout lança um erro que deixa explícito que **o resultado é desconhecido** (a venda pode ter sido criada), para o domínio fazer a checagem anti-duplicata via `listSales`.

### Simulador (fake)

- Implementa o mesmo `RevgasClient`, **em memória**, com estado durante a vida do processo.
- Gera respostas no formato real (mesmos schemas), incluindo campos como `id`, `status`, `total`, `created_at`.
- **Clientes**: semeados com alguns clientes fictícios (telefones de teste configuráveis) para a demo mostrar o caminho "cliente conhecido"; `createCustomer` acrescenta; telefone duplicado devolve `RevgasDuplicateError` como a API.
- **Formas de pagamento**: derivadas dos acordos reais quando em modo híbrido (`payment_type_establishment_id` → `payment_type`), com lista fixa de fallback no modo só-fake.
- **Vendas**: `createSale` calcula `total`, devolve status `OPEN` e ID numa faixa que não colide com IDs reais. `getSale`/`listSales` enxergam as vendas simuladas. O status avança com o tempo (`OPEN` → `ACTIVE` → `CONFIRM`) com um entregador fictício, para a demo de "meu gás chegou?".
- Modo só-fake (sem chave) também simula as leituras a partir de fixtures anonimizadas.

### Roteamento híbrido

Para cada operação, a tabela de permissões acima decide: real ou fake. Detalhe das vendas: `getSale(id)` e `listSales` respondem pelo fake quando o ID ou o cliente pertence ao simulador; caso contrário, vão à API real. Assim vendas criadas pelo bot aparecem nas consultas, e o histórico real continua acessível.

Quando a RevGás liberar uma permissão, trocar uma operação isolada para a real exige editar o roteamento em `HybridRevgasClient` (mudança pequena e teste); trocar a API inteira é só `REVGAS_MODE=live`.

### Configuração (env)

| Variável | Papel | Padrão |
| --- | --- | --- |
| `REVGAS_MODE` | `live` (tudo real), `hybrid`, `fake` | `hybrid` com chave; `fake` sem chave |
| `REVGAS_API_URL` | base da API | `https://api.revgas.com/v1` |
| `REVGAS_API_KEY` | chave (só servidor) | — |
| `REVGAS_ESTABLISHMENT_ID` | estabelecimento | obrigatório em `live`/`hybrid` |
| `REVGAS_TIMEOUT_MS` | timeout por chamada | 10000 |
| `REVGAS_MIN_INTERVAL_MS` | espaçamento da fila | 1100 |

Em `NODE_ENV=production`, `REVGAS_MODE=fake` é permitido (é a demo), mas deve gerar um aviso no boot. Documentar tudo em `docs/guides/conventions/environment.md` e `.env.example`.

### Testes

- Unitários (Vitest), sem rede: `fetch` injetado/stubado para o cliente HTTP — cobre header de auth, fila 1 req/s (com timers falsos), retry só nos casos permitidos, nunca-retry em POST, mapeamento de cada status de erro, validação tolerante de schema, máscara nos logs e ausência da chave nos logs.
- Fake: comportamento de cada operação, duplicidade de telefone, avanço de status.
- Híbrido: roteamento por operação e por ID de venda.
- Fixtures de resposta inspiradas nos dados reais, **anonimizadas** e sem copiar a spec privada.
- Script manual de leitura (fora do CI) para conferir os contratos contra a API real; nunca faz escrita.

## Fica a critério do builder

- Nomes exatos de arquivos, métodos e tipos; divisão dos schemas por arquivo.
- Algoritmo de backoff e número máximo de tentativas (com limites sensatos).
- Formato da faixa de IDs do fake, velocidade do avanço de status, conteúdo das seeds.
- Como o módulo Nest é montado (factory por modo).
- Onde fica o script manual de leitura.

## Minhas escolhas (não confirmadas pelo grupo)

- Fake em memória (perde estado ao reiniciar) em vez de Redis.
- Erros próprios da lib em vez de `AppError`.
- Campos em snake_case na fronteira da lib.
- Avanço de status por tempo no fake.
- Pelo menos um cliente simulado com `tag_id` de uma categoria que existe nos acordos reais, para a demo exercitar preço por categoria.
- `GET /sales/{id}` tratado como liberado (mesma permissão de listar); se der 403, passa para o fake editando o roteamento em `HybridRevgasClient`.
- `REVGAS_MODE` com três modos e padrão automático pela presença da chave.
