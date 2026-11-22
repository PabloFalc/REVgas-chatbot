# Integração RevGás (`lib/revgas`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar `src/lib/revgas`: contrato tipado da API RevGás com três implementações (real, simulada, híbrida) escolhidas por configuração.

**Architecture:** Uma interface `RevgasClient` (snake_case, nomes da RevGás) com schemas Zod tolerantes. `RevgasHttp` é o transporte (fila 1 req/s, timeout, retry só em GET, logs mascarados, erros mapeados); `HttpRevgasClient` monta as rotas sobre ele. `FakeRevgasClient` simula em memória com estado. `HybridRevgasClient` manda leituras liberadas para o real e o resto para o fake. `RevgasModule` provê `REVGAS_CLIENT` conforme `REVGAS_MODE`.

**Tech Stack:** NestJS 11, Zod 4, `fetch` nativo (Node 24), Vitest, nestjs-pino. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-19-revgas-integration-design.md` (fatos da API: `docs/project/specs.md`; spec privada em `docs/project/private/`, fora do git — **nunca commitar nem copiar**).

## Global Constraints

- Gerenciador: `pnpm`. Lint: `pnpm lint` (Biome: aspas simples, ponto e vírgula, 2 espaços, linha 100). Testes unitários: `src/**/*.spec.ts`, `pnpm test`.
- **Sem comentários `//` explicativos no código** (CLAUDE.md).
- Commits com conventional commits, terminando com as linhas de atribuição da sessão.
- Branch: `feat/revgas-integration` a partir de `develop` (gitflow em `docs/guides/conventions/ci-cd.md`).
- A chave (`REVGAS_API_KEY`) nunca aparece em log, mensagem de erro ou resposta.
- Nunca logar corpo de request/response; query só mascarada (telefone, CPF, nome, logradouro).
- `POST`/`PUT` nunca são repetidos automaticamente.
- Schemas de resposta: objetos com `z.looseObject` (extras preservados), campos opcionais salvo `id` e o que o domínio exige; `payment_type` e `status` aceitam string desconhecida.
- Header de auth: `Authorization: <chave>` (sem `Bearer`). Base padrão `https://api.revgas.com/v1`.
- Nenhum teste chama a API real, exceto o check manual (Task 8), que fica fora de `pnpm test` e `pnpm test:e2e` e só faz GET.
- Fixtures anonimizadas: sem nomes, CPFs ou telefones reais.

## Review Focus

1. **Timeout em `createSale`** — o pedido pode ter sido criado; espera-se `RevgasUnknownOutcomeError`, nunca nova tentativa. Teste na Task 4.
2. **Chave ou telefone vazando em log** — inclusive em erros e retries. Teste na Task 4 (`não loga a chave nem o telefone cru`).
3. **Resposta com campo/enum novo** (`GAS_DO_POVO`, status inédito) — deve passar. Teste na Task 2.
4. **Resposta não-JSON ou corpo vazio em erro 5xx/HTML de proxy** — deve virar `RevgasUnavailableError`, não `SyntaxError`. Teste na Task 3.
5. **Telefone em formatos diferentes no fake** (`+5586…`, `86…`, com máscara) — deve achar o mesmo cliente. Teste na Task 6.

---

### Task 0: Branch e commit dos docs

**Files:** já modificados nesta sessão: `docs/project/specs.md`, `docs/project/requisitos.md`, `docs/project/fluxo.md`, `docs/superpowers/specs/2026-10-19-revgas-integration-design.md`, este plano.

- [ ] **Step 1:** `git switch develop && git pull --ff-only && git switch -c feat/revgas-integration`. Se `develop` não contiver o commit inicial de `main`, pare e pergunte.
- [ ] **Step 2:** Confirmar que `git status` **não** lista nada em `docs/project/private/` (é ignorada).
- [ ] **Step 3:** Commit: `docs: registra integração RevGás (acordos, permissões da chave) e design de lib/revgas`.

---

### Task 1: Configuração (env)

**Files:**
- Modify: `src/config/env.ts`, `src/config/env.spec.ts`, `.env.example`, `docs/guides/conventions/environment.md`
- Create: `src/lib/revgas/revgas.config.ts`, `src/lib/revgas/revgas.config.spec.ts`

**Interfaces:**
- Produces:
  - Novas chaves em `Env`: `REVGAS_MODE?: 'live'|'hybrid'|'fake'`, `REVGAS_API_URL: string` (default `'https://api.revgas.com/v1'`), `REVGAS_API_KEY?: string`, `REVGAS_ESTABLISHMENT_ID?: number`, `REVGAS_TIMEOUT_MS: number` (default `10000`), `REVGAS_MIN_INTERVAL_MS: number` (default `1100`).
  - `type RevgasMode = 'live' | 'hybrid' | 'fake'`
  - `interface RevgasConfig { mode: RevgasMode; baseUrl: string; apiKey?: string; establishmentId?: number; timeoutMs: number; minIntervalMs: number }`
  - `resolveRevgasConfig(env: Env): RevgasConfig` em `revgas.config.ts`

- [ ] **Step 1: Testes que falham** em `revgas.config.spec.ts`:
  - `usa hybrid quando há chave e REVGAS_MODE não foi definido` → `mode === 'hybrid'`
  - `usa fake quando não há chave` → `mode === 'fake'`
  - `respeita REVGAS_MODE explícito` (`'live'` com chave e estabelecimento)
  - `falha em live/hybrid sem REVGAS_ESTABLISHMENT_ID` → lança `Error` cuja mensagem cita `REVGAS_ESTABLISHMENT_ID`
  - `falha em live/hybrid sem REVGAS_API_KEY`
  
  E em `env.spec.ts`: `REVGAS_API_URL vazio usa o default` (`'https://api.revgas.com/v1'`) — substitui a asserção atual `toBeUndefined()` para essa chave; `REVGAS_MODE inválido é recusado`; `REVGAS_ESTABLISHMENT_ID é coerido para número`.
- [ ] **Step 2:** `pnpm test src/config src/lib/revgas` → FAIL.
- [ ] **Step 3:** Implementar no schema (`emptyAsUndefined` como as demais) e `resolveRevgasConfig`. A checagem de chave/estabelecimento fica em `resolveRevgasConfig`, não no schema global, para o app subir em `fake` sem nada.
- [ ] **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5:** `.env.example` (seção REVGAS com as seis variáveis, `REVGAS_MODE` comentado explicando o padrão automático) e linhas na tabela de `environment.md` (função e consequência de cada uma; `fake` em produção = demo, gera aviso).
- [ ] **Step 6:** `pnpm lint` limpo. Commit `feat(revgas): configuração de modo, estabelecimento e limites`.

---

### Task 2: Contrato — schemas e interface

**Files:**
- Create: `src/lib/revgas/revgas.schemas.ts`, `src/lib/revgas/revgas.schemas.spec.ts`, `src/lib/revgas/revgas.client.ts`

**Interfaces:**
- Produces (`revgas.schemas.ts`), schemas Zod e os tipos `z.infer` homônimos sem o sufixo `Schema`:
  - `openEnum(values: readonly string[])` — aceita os conhecidos e qualquer string.
  - `PAYMENT_TYPES` (os 17 da spec + `'GAS_DO_POVO'`), `SALE_STATUSES` (`CANCEL, OPEN, ACTIVE, WARNING, CONFIRM, CHECK`), `SALE_CHANNELS` (`DISK, SINO, WHATSAPP`).
  - `RevgasPaginationSchema` `{ page, count, total_count, page_size?, has_next? }` (números).
  - `pageSchema(item)` → `{ data: item[], pagination }`.
  - `RevgasEstablishmentSchema` (`id`, `name?`, `display_name?`, `accept_order?`, `ignore_stock_check?`, `allow_vale_gas?`).
  - `RevgasProductSchema` (`id`, `description`, `stock_quantity?`, `inactive?`, `container_id?`, `revgas_product_id?`, `establishment_id?`).
  - `RevgasDealSchema` (`id`, `product_id`, `suggested_value`, `minimum_value`, `payment_type` (openEnum), `payment_type_establishment_id?`, `type?` openEnum `PAYMENT_TYPE|TAG|CUSTOMER`, `tag_id?`, `customer_id?`, `is_default?`, `product_description?`).
  - `RevgasPaymentTypeSchema` (`id`, `payment_type`, `status?`).
  - `RevgasCustomerSchema` (`id`, `name?`, `cpf?`, `phones?: string[]`, `location?`, `number?`, `neighborhood?`, `city?`, `state_federation?`, `complement?`, `landmark?`, `postal_code?`, `tag_id?`, `last_sale?`).
  - `RevgasCustomerInputSchema` (mesmos campos de cadastro, todos opcionais, sem `id`).
  - `RevgasSaleProductSchema` (`product_id`, `quantity`, `value`, `discount?`, `product_description?`), `RevgasSalePaymentSchema` (`payment_type`, `value`).
  - `RevgasSaleSchema` (`id`, `status` openEnum, `channel?`, `total?`, `customer_id?: number|null`, `customer_name?: string|null`, `deliverer_id?: number|null`, `deliverer_name?: string|null`, `delivered_at?`, `date?`, endereço opcional, `observation?`, `products?`, `payments?`, `establishment_id?`).
  - `RevgasSaleInputSchema` (sem `establishment_id`): endereço (`location`, `number`, `neighborhood`, `city`, `state_federation` obrigatórios; `complement?`, `landmark?`, `lat?`, `lon?`), `customer_id?`, `observation?`, `channel` (default `'WHATSAPP'`), `origin?` (`ENTREGA|REVGAS|INTEGRATION`), `broadcast?` (`OLD_SALE|NEW_SALE|NONE`), `products` (min 1, `quantity` inteiro ≥ 1, `value` > 0), `payments` (min 1, `value` > 0).
- Produces (`revgas.client.ts`):

```ts
export const REVGAS_CLIENT = Symbol('REVGAS_CLIENT');
export type Page<T> = { data: T[]; pagination: RevgasPagination };
export type PageQuery = { page?: number; page_size?: number };
export type ListProductsQuery = PageQuery & { inactive?: boolean; description?: string };
export type ListDealsQuery = PageQuery & { product_id?: number; customer_id?: number; tag_id?: number; payment_type?: string };
export type ListSalesQuery = PageQuery & { customer_id?: number; channel?: string; status?: string; from?: string; to?: string };
export interface RevgasClient {
  listEstablishments(): Promise<Page<RevgasEstablishment>>;
  listProducts(query?: ListProductsQuery): Promise<Page<RevgasProduct>>;
  listDeals(query?: ListDealsQuery): Promise<Page<RevgasDeal>>;
  listAllDeals(query?: Omit<ListDealsQuery, 'page' | 'page_size'>): Promise<RevgasDeal[]>;
  listPaymentTypes(): Promise<RevgasPaymentType[]>;
  findCustomersByPhone(phone: string): Promise<RevgasCustomer[]>;
  getCustomer(id: number): Promise<RevgasCustomer>;
  createCustomer(input: RevgasCustomerInput): Promise<RevgasCustomer>;
  updateCustomer(id: number, input: RevgasCustomerInput): Promise<RevgasCustomer>;
  createSale(input: RevgasSaleInput): Promise<RevgasSale>;
  getSale(id: number): Promise<RevgasSale>;
  listSales(query?: ListSalesQuery): Promise<Page<RevgasSale>>;
  cancelSale(id: number, motiveCancelSaleId?: number | null): Promise<RevgasSale>;
}
```

- [ ] **Step 1: Testes que falham:**
  - `preserva campos desconhecidos` — produto com `commission_value: 0` parseia e mantém a chave.
  - `aceita payment_type fora da spec` — acordo com `payment_type: 'GAS_DO_POVO'` e outro com `'NOVO_TIPO'` passam.
  - `aceita status de venda desconhecido` — `status: 'RECEIVED'` passa; `'WARNING'` passa.
  - `exige id` — produto sem `id` falha.
  - `aceita customer_id null na venda`.
  - `pagination sem has_next passa`.
  - `RevgasSaleInputSchema recusa produtos vazios, quantidade 0 e valor 0`; `aplica channel WHATSAPP por padrão`.
- [ ] **Step 2:** `pnpm test src/lib/revgas` → FAIL.
- [ ] **Step 3:** Implementar os schemas e a interface (sem implementação de cliente).
- [ ] **Step 4:** `pnpm test` → PASS; `pnpm build` compila.
- [ ] **Step 5:** Commit `feat(revgas): contrato tipado e schemas tolerantes`.

---

### Task 3: Erros e mapeamento de status

**Files:**
- Create: `src/lib/revgas/revgas.errors.ts`, `src/lib/revgas/revgas.errors.spec.ts`

**Interfaces:**
- Produces:
  - `type RevgasErrorKind = 'unauthorized'|'blocked'|'forbidden'|'not_found'|'validation'|'duplicate'|'unavailable'|'response'|'unknown_outcome'`
  - `class RevgasError extends Error { readonly kind: RevgasErrorKind; readonly status?: number }`
  - Subclasses: `RevgasUnauthorizedError` (401), `RevgasBlockedError` (402), `RevgasForbiddenError` (403), `RevgasNotFoundError` (404), `RevgasValidationError` (400/422, `fields: { field: string; message: string }[]`), `RevgasDuplicateError` (409 duplicado, `existingId?: number`), `RevgasUnavailableError` (429, 5xx, 409 lock, timeout, rede), `RevgasResponseError` (schema, `issues: { path: string; message: string }[]`, sem valores), `RevgasUnknownOutcomeError` (POST sem resposta).
  - `mapRevgasError(status: number, body: unknown): RevgasError`
  - `isRetryableStatus(status: number, body: unknown): boolean` — 429, ≥500, ou 409 cuja `message` casa `/lock/i`.

- [ ] **Step 1: Testes que falham** (um por linha da tabela do design):
  - 401/402/403/404 → classe e `kind` corretos, `message` vinda do corpo `{ message }`.
  - 422 `{ data: [{ field: 'name', message: 'required' }], message: 'Request error' }` → `RevgasValidationError` com `fields` igual.
  - 400 `{ message: 'x' }` → `RevgasValidationError` com `fields: []`.
  - 409 duplicado com `data[0].value_id: '123'` → `RevgasDuplicateError` com `existingId === 123`.
  - 409 `{ message: 'cannot modify object due to lock, try again' }` → `RevgasUnavailableError`; `isRetryableStatus` → `true`.
  - 500 com corpo string HTML (`'<html>bad gateway</html>'`) e com `undefined` → `RevgasUnavailableError`, sem lançar.
  - 418 → `RevgasError` genérico com `status: 418`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(revgas): erros próprios e mapeamento de status`.

---

### Task 4: Transporte HTTP (`RevgasHttp`)

**Files:**
- Create: `src/lib/revgas/http/revgas-http.ts`, `src/lib/revgas/http/revgas-http.spec.ts`, `src/lib/revgas/http/mask.ts`, `src/lib/revgas/http/mask.spec.ts`

**Interfaces:**
- Consumes: erros da Task 3.
- Produces:
  - `maskQuery(query: Record<string, unknown>): Record<string, unknown>` — `phone` → `'*******' + últimos 4`, `cpf_or_cnpj` → `'***' + últimos 2`, `name`/`location` → `'***'`; demais intactos.
  - `type RevgasLogger = { info(obj: object, msg: string): void; warn(obj: object, msg: string): void }`
  - `type RevgasHttpOptions = { baseUrl: string; apiKey: string; timeoutMs: number; minIntervalMs: number; maxRetries?: number /* padrão 3 */; logger: RevgasLogger; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number }`
  - `type RevgasRequest<S extends z.ZodType> = { method: 'GET' | 'POST' | 'PUT'; path: string; query?: Record<string, string | number | boolean | undefined>; body?: unknown; schema: S }`
  - `class RevgasHttp { constructor(options: RevgasHttpOptions); request<S extends z.ZodType>(req: RevgasRequest<S>): Promise<z.infer<S>> }`

- [ ] **Step 1: Testes que falham** (fetch, sleep e now injetados; nenhum timer real):
  - `envia Authorization sem Bearer e Content-Type JSON` — header `Authorization` === chave.
  - `monta a query ignorando undefined`.
  - `espaça chamadas em minIntervalMs` — três GETs disparados juntos; `sleep` recebe esperas que somam ≥ `2 * minIntervalMs` e as chamadas a `fetch` saem em série.
  - `repete GET em 429 e 503 e devolve o sucesso` — fetch responde 429, 503, 200 → 3 chamadas, resultado parseado.
  - `desiste após maxRetries` → `RevgasUnavailableError`.
  - `não repete GET em 400/403/404/422`.
  - `nunca repete POST em 503` → 1 chamada, `RevgasUnavailableError`.
  - `POST com timeout lança RevgasUnknownOutcomeError` (fetch rejeita com `DOMException` `TimeoutError`) — 1 chamada.
  - `POST com erro de rede lança RevgasUnknownOutcomeError`; `GET com erro de rede repete`.
  - `resposta fora do schema lança RevgasResponseError` com `issues[].path` e sem o valor recebido na mensagem.
  - `loga método, rota, status, duração e tentativa`.
  - `não loga a chave nem o telefone cru` — GET com `query.phone = '5586999998888'` que falha e repete: serializar todas as chamadas do logger e checar que não contêm a chave nem `'5586999998888'`, e que contêm `'8888'`.
  - `mask.spec`: os quatro mascaramentos acima.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. Fila: promessa encadeada; cada tentativa (inclusive retry) entra na fila e espera `max(0, último início + minIntervalMs - now())`. Timeout via `AbortSignal.timeout(timeoutMs)`. Backoff entre retries: `500 * 2 ** (tentativa - 1)` ms, somado à espera da fila. Corpo de resposta: `res.text()` e `JSON.parse` protegido (falha → texto cru para `mapRevgasError`).
- [ ] **Step 4:** PASS; `pnpm lint`.
- [ ] **Step 5:** Commit `feat(revgas): transporte HTTP com fila 1 req/s, retry seguro e logs mascarados`.

---

### Task 5: Cliente real (`HttpRevgasClient`)

**Files:**
- Create: `src/lib/revgas/http/http-revgas.client.ts`, `src/lib/revgas/http/http-revgas.client.spec.ts`

**Interfaces:**
- Consumes: `RevgasHttp` (Task 4), `RevgasClient` e schemas (Task 2).
- Produces: `class HttpRevgasClient implements RevgasClient { constructor(http: RevgasHttp, establishmentId: number) }`

Rotas (todas sob a base):

| Método | Rota | Observação |
| --- | --- | --- |
| `listEstablishments` | `GET /establishments` | |
| `listProducts` | `GET /products` | injeta `establishment_id`; `inactive` padrão `false` |
| `listDeals` | `GET /deals` | injeta `establishment_id` |
| `listAllDeals` | `GET /deals` paginado | `page_size: 100`, segue enquanto `has_next` (ou `page * 100 < total_count` se `has_next` ausente) |
| `listPaymentTypes` | `GET /payment-types` | injeta `establishment_id`, `status: 'ACTIVE'`, `page_size: 100`; devolve `data` |
| `findCustomersByPhone` | `GET /customers?phone=` | normaliza para só dígitos; devolve `data` |
| `getCustomer` / `updateCustomer` | `GET` / `PUT /customers/{id}` | |
| `createCustomer` | `POST /customers` | |
| `createSale` | `POST /sales` | valida a entrada com `RevgasSaleInputSchema` e injeta `establishment_id` |
| `getSale` | `GET /sales/{id}` | |
| `listSales` | `GET /sales` | injeta `establishment_id` |
| `cancelSale` | `PUT /sales/{id}/cancel` | corpo `{ motive_cancel_sale_id: motiveCancelSaleId ?? null }` |

- [ ] **Step 1: Testes que falham** (`RevgasHttp` real com `fetch` stubado, `minIntervalMs: 0`): um teste por linha da tabela verificando método, URL e corpo; `listAllDeals junta 3 páginas`; `findCustomersByPhone('+55 (86) 99999-8888')` envia `phone=5586999998888`; `createSale com entrada inválida lança antes de chamar fetch` (ZodError ou `RevgasValidationError` — escolher um e testar esse).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(revgas): cliente HTTP real para as rotas do fluxo`.

---

### Task 6: Simulador (`FakeRevgasClient`)

**Files:**
- Create: `src/lib/revgas/fake/fake-revgas.client.ts`, `src/lib/revgas/fake/fake-revgas.client.spec.ts`, `src/lib/revgas/fake/fixtures.ts`

**Interfaces:**
- Consumes: contrato (Task 2), erros (Task 3).
- Produces:
  - `FAKE_ID_START = 900_000_000`
  - `type FakeRevgasOptions = { now?: () => number; seedCustomers?: RevgasCustomer[]; dealsSource?: () => Promise<RevgasDeal[]> }`
  - `class FakeRevgasClient implements RevgasClient { constructor(options?: FakeRevgasOptions); ownsSale(id: number): boolean; ownsCustomer(id: number): boolean }`
  - `fixtures.ts`: `FAKE_ESTABLISHMENT`, `FAKE_PRODUCTS` (GLP 13KG com `container_id` → VASILHAME 13KG, GLP 45KG, AGUA 20L), `FAKE_DEALS` (preço base por forma de pagamento para esses produtos: GLP 13KG 125 em PIX/MONEY/CARTAO_DE_DEBITO e 133 em CARTAO_DE_CREDITO; mais um acordo `TAG` com `tag_id: 3519`, GLP 13KG, MONEY, 85), `FAKE_CUSTOMERS` (2 clientes fictícios, ids ≥ `FAKE_ID_START`, telefones `5586900000001` e `5586900000002`, um com `tag_id: 3519`, endereço em Teresina/PI), `FAKE_PAYMENT_TYPES` (MONEY, PIX, CARTAO_DE_CREDITO, CARTAO_DE_DEBITO).

Comportamento:
- Leituras de catálogo vêm das fixtures (no modo híbrido o roteador nem chama essas).
- `listAllDeals` filtra `FAKE_DEALS` como `listDeals`.
- `listPaymentTypes`: com `dealsSource`, deriva pares únicos `payment_type_establishment_id → payment_type` (ids ausentes ignorados); sem ele, `FAKE_PAYMENT_TYPES`.
- Clientes: busca por telefone compara os últimos 10–11 dígitos ignorando `55` e máscara; `createCustomer` exige `phones` de 12–13 dígitos (senão `RevgasValidationError` com campo `phones`) e recusa telefone já cadastrado com `RevgasDuplicateError(existingId)`; `getCustomer`/`updateCustomer` inexistente → `RevgasNotFoundError`.
- Vendas: `createSale` valida com `RevgasSaleInputSchema`, cria id a partir de `FAKE_ID_START`, `total = Σ quantity × value`, `status: 'OPEN'`, `date`/`created_at` de `now()`, `customer_name` do cliente fake quando houver. `getSale` calcula o status pelo tempo: `< 2 min` `OPEN`; `< 10 min` `ACTIVE` com `deliverer_id: FAKE_ID_START`, `deliverer_name: 'Entregador Demo'`; depois `CONFIRM` com `delivered_at`. Cancelada fica `CANCEL` para sempre. `listSales` filtra por `customer_id`/`channel`/`status`, ordena por data desc e pagina.

- [ ] **Step 1: Testes que falham:**
  - `acha cliente com telefone em formatos diferentes` — `'5586900000001'`, `'+55 86 90000-0001'`, `'86900000001'` → mesmo id.
  - `cadastra cliente e acha pelo telefone`; `recusa telefone duplicado com existingId`; `recusa phones com 11 dígitos`.
  - `cria venda com total calculado e status OPEN`; `venda avança para ACTIVE aos 2 min e CONFIRM aos 10 min` (com `now` controlado); `venda cancelada não avança`.
  - `listSales por customer_id devolve só as vendas do cliente, mais recente primeiro`.
  - `getSale inexistente lança RevgasNotFoundError`.
  - `listPaymentTypes deriva dos acordos quando há dealsSource` (inclui `GAS_DO_POVO` vindo do source).
  - `ownsSale/ownsCustomer` verdadeiros só para ids ≥ `FAKE_ID_START` criados ou semeados.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(revgas): simulador em memória para operações sem permissão`.

---

### Task 7: Roteador híbrido e módulo Nest

**Files:**
- Create: `src/lib/revgas/hybrid-revgas.client.ts`, `src/lib/revgas/hybrid-revgas.client.spec.ts`, `src/lib/revgas/revgas.module.ts`, `src/lib/revgas/revgas.factory.ts`, `src/lib/revgas/revgas.factory.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 5, 6.
- Produces:
  - `class HybridRevgasClient implements RevgasClient { constructor(live: RevgasClient, fake: FakeRevgasClient) }`
  - `createRevgasClient(config: RevgasConfig, deps?: { logger?: RevgasLogger; fetch?: typeof fetch; nodeEnv?: string }): RevgasClient`
  - `RevgasModule` (`@Module`) que provê e exporta `REVGAS_CLIENT` via `useFactory: () => createRevgasClient(resolveRevgasConfig(env), { logger: createLogger('RevgasClient'), nodeEnv: env.NODE_ENV })`.

Roteamento do híbrido:
- live: `listEstablishments`, `listProducts`, `listDeals`, `listAllDeals`.
- fake: `listPaymentTypes` (fake construído com `dealsSource: () => live.listAllDeals()`), `findCustomersByPhone`, `getCustomer`, `createCustomer`, `updateCustomer`, `createSale`, `cancelSale`.
- `getSale(id)`: `fake.ownsSale(id)` ? fake : live.
- `listSales(q)`: `q.customer_id !== undefined && fake.ownsCustomer(q.customer_id)` ? fake : live.

- [ ] **Step 1: Testes que falham** (live e fake com `vi.fn`/spies):
  - `leituras de catálogo vão para o live`; `clientes e escrita vão para o fake` (o live não recebe nenhuma chamada).
  - `getSale de venda simulada vai ao fake; de venda real vai ao live`.
  - `listSales de cliente simulado vai ao fake; sem customer_id vai ao live`.
  - Factory: `mode fake → FakeRevgasClient`; `hybrid → HybridRevgasClient`; `live → HttpRevgasClient`; `avisa no log quando nodeEnv é production e mode não é live` (`logger.warn` chamado uma vez).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. O módulo não é importado por nenhum outro ainda.
- [ ] **Step 4:** `pnpm test`, `pnpm build`, `pnpm lint` → limpos. `pnpm test:e2e` (com `pnpm docker:init`) continua verde — nada foi plugado no `AppModule`.
- [ ] **Step 5:** Commit `feat(revgas): roteador híbrido e RevgasModule por modo`.

---

### Task 8: Check manual contra a API real e documentação

**Files:**
- Create: `scripts/revgas.live-check.spec.ts`, `vitest.config.live.ts`, `docs/guides/lib/revgas.md`
- Modify: `package.json` (script `revgas:check`), `docs/README.md`, `CLAUDE.md` (árvore `src/` atual passa a ter `lib/revgas`; link do novo guia em Documentation)

**Interfaces:**
- Consumes: `HttpRevgasClient`, `RevgasHttp`, `resolveRevgasConfig`.

- [ ] **Step 1:** `vitest.config.live.ts` — mesma base do `vitest.config.ts`, `include: ['scripts/**/*.live-check.spec.ts']`, `testTimeout: 120000`. Script `"revgas:check": "vitest run --config vitest.config.live.ts"`. Confirmar que `vitest.config.ts` e `vitest.config.e2e.ts` não incluem `scripts/`.
- [ ] **Step 2:** `revgas.live-check.spec.ts` — `describe.skipIf(!env.REVGAS_API_KEY)`; só GET via `HttpRevgasClient` real (`minIntervalMs` da config): `listEstablishments` contém `REVGAS_ESTABLISHMENT_ID`; `listProducts` não vazio; `listDeals({ page_size: 100 })` não vazio e todo item tem `payment_type`; `listSales({ page_size: 5 })` parseia. Os testes de clientes e formas de pagamento esperam `RevgasForbiddenError` (documentam a permissão atual). Nenhum teste imprime dados de cliente.
- [ ] **Step 3:** Rodar `pnpm revgas:check` com o `.env` local (sem ler o `.env`) → PASS. Se algum schema falhar, ajustar o schema (Task 2) para tolerar o dado real e registrar no commit.
- [ ] **Step 4:** Guia `docs/guides/lib/revgas.md`: o que é a lib, os três modos e o padrão, tabela de roteamento do híbrido, permissões atuais da chave, como passar uma operação para real quando a RevGás liberar (`REVGAS_MODE=live`), erros e quando cada um aparece, regra de nunca repetir POST e o que fazer com `RevgasUnknownOutcomeError` (conferir com `listSales`), como rodar `pnpm revgas:check`. Link em `docs/README.md` (nova seção "Bibliotecas (`guides/lib/`)") e em `CLAUDE.md`.
- [ ] **Step 5:** `pnpm lint`, `pnpm test` limpos. Commit `docs(revgas): guia da lib e check manual da API real`.

---

## Self-review

- Cobertura do spec: contrato (T2), schemas tolerantes (T2), cliente HTTP com fila/timeout/retry/logs (T4–T5), erros (T3), fake com seeds, derivação de pagamentos, faixa de IDs e avanço de status (T6), híbrido e roteamento de vendas (T7), env + aviso em produção (T1, T7), testes sem rede (todas), script manual só leitura (T8), docs (T1, T8).
- Tipos usados entre tarefas conferidos: `RevgasConfig`, `RevgasLogger`, `RevgasHttp.request`, `FakeRevgasClient.ownsSale/ownsCustomer`, `createRevgasClient`.
