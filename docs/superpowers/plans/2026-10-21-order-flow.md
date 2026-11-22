# Fluxo de pedido pelo WhatsApp — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a resposta de teste do bot pelo pedido completo: do "oi" até a venda criada na RevGás (F01 + F02).

**Architecture:** Cada assunto da conversa (cliente, endereço, produto, pagamento, resumo) é um arquivo de etapa em `src/modules/conversation/flow/steps/`, todos no mesmo formato: um mapa `asks` (o que o bot pergunta ao entrar em cada estado) e um mapa `handlers` (o que fazer com a resposta). As etapas recebem uma interface `FlowTools` com as operações externas; em produção ela delega aos módulos `customer`, `catalog`, `order` e `address`, nos testes é um fake. O estado do pedido fica no Redis com TTL de 15 min.

**Tech Stack:** NestJS 11, TypeScript, Zod, ioredis, Vitest, Biome. Integrações existentes: `integrations/revgas`, `integrations/whatsapp`, `integrations/llm`. Nova: `integrations/viacep`.

**Spec:** `docs/superpowers/specs/2026-10-21-order-flow-design.md`

## Global Constraints

- Nomes de código em inglês; todo texto mostrado ao cliente em português e **só** em `src/modules/conversation/flow/messages.ts`. Se `messages.ts` passar de 500 linhas, parar e avisar o usuário.
- Sem comentários `//` explicativos no código (regra do `CLAUDE.md`).
- Etapas (`flow/steps/*`) não importam Nest, Redis, `integrations/` nem serviços/repositórios; só `flow.types.ts`, `messages.ts`, `input.ts`, `next-step.ts`, outras etapas, `src/utils` e arquivos `src/modules/*/contracts/*` (tipos e classes de erro puras).
- Módulos de domínio não importam SDKs: acesso pelo `REVGAS_CLIENT`, `LLM_CLIENT`, `VIACEP_CLIENT` e `RedisService`.
- Nenhum retry automático de criar venda. Venda só nasce de `summary:confirm` no estado `summary`.
- CPF, telefone e endereço nunca em log sem máscara (`maskDocument`, `maskPhone`); CPF nunca no prompt da IA.
- TTL do pedido em andamento: **900 s** (15 min), renovado a cada mensagem.
- Cache do catálogo (produtos, formas de pagamento, acordos, estabelecimento): **600 s**.
- Limites do WhatsApp: até 3 botões (título ≤ 20), lista até 10 linhas (título ≤ 24, descrição ≤ 72).
- Commits em conventional commits (`feat:`, `test:`, `docs:`…), **sem** linhas `Co-Authored-By`/`Claude-Session`.
- Comandos: `pnpm test` (unit), `pnpm lint`, `pnpm test:e2e` (precisa `pnpm docker:init`).

## Review Focus

1. **Botão antigo tocado fora de hora** (ex.: `product:12` quando a etapa é pagamento, ou `summary:confirm` depois da venda): a etapa repete a própria pergunta e nada é criado. Teste em Task 12 (`flow.spec.ts`).
2. **Dois toques rápidos em "Confirmar"**: só uma venda. Teste em Task 13 (estado `creatingSale`) e Task 14 (trava por telefone).
3. **Texto livre com CPF ou telefone junto do endereço**: o CPF não pode ir para a IA. Teste em Task 5 (`address.service.spec.ts`: dígitos de 11 posições são removidos do texto antes do prompt).
4. **Correção que muda o total com troco já informado**: troco menor que o novo total é perguntado de novo. Teste em Task 13.
5. **RevGás fora do ar no meio do fluxo** (leitura): mensagem de instabilidade, estado mantido, próxima mensagem repete a etapa. Teste em Task 12 (`flow.spec.ts`).

---

## Mapa de arquivos

```
src/utils/cpf.ts, cpf.spec.ts                      isValidCpf, onlyDigits
src/utils/money.ts, money.spec.ts                  formatMoney, parseMoney
src/infra/cache/redis.service.ts                   + delete()
src/integrations/viacep/                           cliente ViaCEP (live/fake), igual ao padrão do whatsapp
src/core/erros/viacep/viacep.errors.ts             ViacepError
src/modules/address/contracts/address.types.ts     Address, AddressDraft, AddressField
src/modules/address/address.service.ts             fromCep, fromText (IA), complete
src/modules/address/address.module.ts
src/modules/customer/contracts/customer.types.ts   Customer, NewCustomer, CustomerHistory
src/modules/customer/customer.repository.ts        findByPhone, create, saveCpf, history
src/modules/customer/customer.module.ts
src/modules/catalog/contracts/catalog.types.ts     Product, PaymentOption, Quote, PriceCustomer
src/modules/catalog/price.ts                       pickDeal (pura)
src/modules/catalog/payment-labels.ts              paymentLabel (pura)
src/modules/catalog/catalog.repository.ts          listProducts, listPaymentOptions, quote (com cache)
src/modules/catalog/catalog.module.ts
src/modules/order/contracts/order.types.ts         SaleOrder
src/modules/order/order.repository.ts              createSale, findRecentSale
src/modules/order/order.module.ts
src/modules/conversation/flow/flow.types.ts        Step, OrderState, FlowInput, FlowTools, StepResult, AskFn, HandleFn
src/modules/conversation/flow/input.ts             textOf, choiceOf, fit
src/modules/conversation/flow/messages.ts          todos os textos
src/modules/conversation/flow/global-commands.ts   cancelar, atendente, desconto, não suportado
src/modules/conversation/flow/next-step.ts         nextStep: vai para o que falta no pedido
src/modules/conversation/flow/flow.ts              runFlow: porta de entrada
src/modules/conversation/flow/steps/*.step.ts      customer, address, product, payment, summary
src/modules/conversation/flow/steps/index.ts       junta `asks` e `handlers` de todas as etapas
src/modules/conversation/flow/testing/fake-tools.ts  createFakeTools (só testes)
src/modules/conversation/flow-tools.ts             FlowToolsService implements FlowTools
src/modules/conversation/conversation.repository.ts  + loadOrder/saveOrder/clearOrder/lock
src/modules/conversation/conversation.service.ts   usa runFlow no lugar de replyTo
```

---

### Task 1: Utilitários de CPF e dinheiro

**Files:**
- Create: `src/utils/cpf.ts`, `src/utils/cpf.spec.ts`, `src/utils/money.ts`, `src/utils/money.spec.ts`

**Interfaces:**
- Produces: `onlyDigits(text: string): string`, `isValidCpf(text: string): boolean`, `formatMoney(value: number): string`, `parseMoney(text: string): number | null`

- [ ] **Step 1: Testes que falham**

```ts
// cpf.spec.ts
it('aceita CPF válido com ou sem pontuação', () => {
  expect(isValidCpf('529.982.247-25')).toBe(true);
  expect(isValidCpf('52998224725')).toBe(true);
});
it('recusa dígito errado, tamanho errado e dígitos repetidos', () => {
  expect(isValidCpf('52998224724')).toBe(false);
  expect(isValidCpf('5299822472')).toBe(false);
  expect(isValidCpf('11111111111')).toBe(false);
});
it('onlyDigits remove tudo que não é dígito', () => expect(onlyDigits('a1.2-3')).toBe('123'));

// money.spec.ts
it('formata em reais com espaço comum', () => expect(formatMoney(220)).toBe('R$ 220,00'));
it('formata milhar', () => expect(formatMoney(1250.5)).toBe('R$ 1.250,50'));
it.each([['250', 250], ['250,00', 250], ['R$ 250', 250], ['r$250,50', 250.5], ['1.250,00', 1250], ['250.5', 250.5]])(
  'lê %s', (text, value) => expect(parseMoney(text)).toBe(value));
it.each(['', 'abc', '-10', '0'])('recusa %s', text => expect(parseMoney(text)).toBeNull());
```

- [ ] **Step 2:** `pnpm test src/utils` → FAIL (módulos não existem).
- [ ] **Step 3: Implementar.** `formatMoney` usa `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` e troca ` ` por espaço. `parseMoney`: remove `R$` e espaços (sem diferenciar maiúsculas); se tem vírgula, pontos são milhar e a vírgula é decimal; senão `Number()`. Retorna `null` se não for número finito > 0.
- [ ] **Step 4:** `pnpm test src/utils` → PASS.
- [ ] **Step 5: Commit** `feat(utils): validação de CPF e formato de dinheiro`

---

### Task 2: `RedisService.delete`

**Files:**
- Modify: `src/infra/cache/redis.service.ts`, `src/infra/cache/cache-client.interface.ts`
- Test: o spec existente do RedisService (ou criar `src/infra/cache/redis.service.spec.ts` com um `Redis` mockado, no padrão dos outros specs)

**Interfaces:**
- Produces: `RedisService.delete(params: CacheGetParams): Promise<void>` (também em `ICacheClient` e em `withPrefix`)

- [ ] **Step 1:** Teste: `delete({ prefix: 'p', key: 'k' })` chama `redis.del('p:k')`; erro do Redis é logado e não propaga.
- [ ] **Step 2:** Rodar → FAIL.
- [ ] **Step 3:** Implementar no mesmo estilo de `exists` (try/catch + log).
- [ ] **Step 4:** Rodar → PASS.
- [ ] **Step 5: Commit** `feat(cache): RedisService.delete`

---

### Task 3: Integração ViaCEP

Seguir o molde de `src/integrations/whatsapp` (config + factory + módulo + cliente live + fake), em escala menor.

**Files:**
- Create: `src/integrations/viacep/viacep.client.ts`, `http-viacep.client.ts`, `fake-viacep.client.ts`, `viacep.factory.ts`, `viacep.module.ts`, `shared/viacep.config.ts`, specs de cada um
- Create: `src/core/erros/viacep/viacep.errors.ts`
- Modify: `src/config/env.ts`, `.env.example`, `docs/guides/conventions/environment.md`
- Create: `docs/guides/integrations/viacep.md` (curto: o que é, modos, variáveis, erros, fake)

**Interfaces:**
- Produces:
  ```ts
  export const VIACEP_CLIENT = Symbol('VIACEP_CLIENT');
  export interface ViacepAddress { postalCode: string; street: string; neighborhood: string; city: string; state: string }
  export interface ViacepClient { lookup(cep: string): Promise<ViacepAddress | null> }
  export class FakeViacepClient implements ViacepClient { set(cep: string, address: ViacepAddress): void; failNext(): void }
  export class ViacepError extends Error {}
  ```
- Env: `VIACEP_MODE` (`live` | `fake`, padrão `live` fora de `test`, `fake` em `NODE_ENV=test`), `VIACEP_API_URL` (padrão `https://viacep.com.br/ws`), `VIACEP_TIMEOUT_MS` (padrão `5000`).

- [ ] **Step 1: Testes que falham** (`http-viacep.client.spec.ts`, com `fetch` injetado):
  - `lookup('64000-000')` chama `GET {url}/64000000/json/` e mapeia `logradouro→street`, `bairro→neighborhood`, `localidade→city`, `uf→state`, `cep→postalCode` (só dígitos).
  - Resposta `{ "erro": true }` (ou `"erro": "true"`) → `null`.
  - CEP com tamanho ≠ 8 dígitos → `null` sem chamar `fetch`.
  - Timeout, rede ou status ≥ 500 → lança `ViacepError`.
  - `fake-viacep.client.spec.ts`: `set` + `lookup` devolve o endereço; CEP desconhecido → `null`; `failNext()` → próxima chamada lança `ViacepError`.
- [ ] **Step 2:** Rodar → FAIL.
- [ ] **Step 3:** Implementar com `fetch` puro + `AbortSignal.timeout`; resposta validada com Zod.
- [ ] **Step 4:** `pnpm test src/integrations/viacep` → PASS; `pnpm lint` → limpo.
- [ ] **Step 5: Commit** `feat(viacep): cliente de consulta de CEP (live/fake)`

---

### Task 4: Tipos de domínio, preço e nomes de pagamento

**Files:**
- Create: `src/modules/address/contracts/address.types.ts`, `src/modules/customer/contracts/customer.types.ts`, `src/modules/catalog/contracts/catalog.types.ts`, `src/modules/order/contracts/order.types.ts`
- Create: `src/modules/catalog/price.ts`, `price.spec.ts`, `payment-labels.ts`, `payment-labels.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // address.types.ts
  export interface Address { street: string; number: string; neighborhood: string; city: string; state: string; complement?: string; landmark?: string; postalCode?: string }
  export type AddressDraft = Partial<Address>;
  export type AddressField = 'street' | 'number' | 'neighborhood';
  // customer.types.ts
  export interface Customer { id: number; name: string; cpf: string | null; tagId: number | null }
  export interface NewCustomer { phone: string; name: string; cpf: string; address: Address }
  export interface CustomerHistory { addresses: Address[]; productIds: number[] }
  export class CpfTakenError extends Error {}          // CPF já cadastrado em outro cliente
  export class CustomerRejectedError extends Error {}  // RevGás recusou os dados do cadastro
  // catalog.types.ts
  export interface Product { id: number; name: string }
  export interface PaymentOption { type: string; label: string }
  export interface Quote { unitPrice: number; total: number }
  export interface PriceCustomer { id?: number; tagId?: number | null }
  // order.types.ts
  export interface SaleOrder { customerId: number; address: Address; productId: number; productName: string; quantity: number; unitPrice: number; paymentType: string; total: number; observation?: string }
  // price.ts
  export function pickDeal(deals: RevgasDeal[], productId: number, paymentType: string, customer: PriceCustomer): RevgasDeal | null
  // payment-labels.ts
  export function paymentLabel(type: string): string
  ```

- [ ] **Step 1: Testes que falham** (`price.spec.ts`), considerando só acordos com o mesmo `product_id` e `payment_type`:
  - Acordo `type: 'CUSTOMER'` com `customer_id` do cliente vence `TAG` e base.
  - Sem acordo do cliente, `type: 'TAG'` com `tag_id` do cliente vence a base.
  - Base = `type: 'PAYMENT_TYPE'` ou sem `type`, sem `customer_id` e sem `tag_id`; entre bases, `is_default: true` vence.
  - Acordo de outro cliente ou de outra categoria nunca é usado.
  - Nada aplicável → `null`.
  - `payment-labels.spec.ts`: `PIX→'Pix'`, `MONEY→'Dinheiro'`, `CARTAO_DE_CREDITO→'Cartão de crédito'`, `CARTAO_DE_DEBITO→'Cartão de débito'`, `VALEGAS→'Vale-gás'`, `TRANSFERENCIA_BANCARIA→'Transferência'`; desconhecido `FOO_BAR→'Foo bar'`.
- [ ] **Step 2:** Rodar → FAIL.
- [ ] **Step 3:** Implementar (funções puras, sem Nest).
- [ ] **Step 4:** Rodar → PASS.
- [ ] **Step 5: Commit** `feat(catalog): tipos de domínio e escolha do acordo de preço`

---

### Task 5: Módulo `address` (CEP e texto livre)

**Files:**
- Create: `src/modules/address/address.service.ts`, `address.service.spec.ts`, `address.module.ts`
- Modify: `src/config/env.ts`, `.env.example`, `docs/guides/conventions/environment.md` (`STORE_CITY` padrão `Teresina`, `STORE_STATE` padrão `PI`; opcionais, porque o CI só define `NODE_ENV` e `DATABASE_URL`)

**Interfaces:**
- Consumes: `VIACEP_CLIENT` (Task 3), `LLM_CLIENT`, tipos da Task 4
- Produces:
  ```ts
  @Injectable() export class AddressService {
    fromCep(cep: string): Promise<AddressDraft | null>;      // null = CEP não existe; lança ViacepError se fora do ar
    fromText(text: string): Promise<AddressDraft | null>;    // null = IA falhou/demorou
    missingField(draft: AddressDraft): AddressField | null;   // ordem: street, number, neighborhood
  }
  ```

- [ ] **Step 1: Testes que falham** (`FakeViacepClient` + `FakeLlmClient`):
  - `fromCep` devolve rua, bairro, cidade, UF e `postalCode`, sem `number`.
  - `fromText` chama a IA com `operation: 'parse-address'` e `schemaName: 'address'`; campos `null` da IA viram ausentes.
  - `fromText` com CEP na resposta da IA completa só os campos que faltam pelo ViaCEP (rua digitada não é sobrescrita).
  - `fromText` sem cidade/UF usa `STORE_CITY`/`STORE_STATE`.
  - `fromText` com a IA lançando `LlmError` → `null`; com ViaCEP lançando → segue sem completar.
  - **Review Focus 3:** `fromText('Rua A 10, Centro, cpf 529.982.247-25')` → a mensagem `user` enviada à IA não contém `52998224725` nem `529.982.247-25`.
  - `missingField({ street: 'Rua A', neighborhood: 'Centro' })` → `'number'`.
- [ ] **Step 2:** Rodar → FAIL.
- [ ] **Step 3:** Implementar. Antes do prompt, remover sequências de 11 dígitos (com ou sem pontuação de CPF). Prompt de sistema (português): extrair rua, número, bairro, cidade, UF, CEP, complemento e referência de um endereço brasileiro; nunca inventar; campo ausente = `null`. Schema Zod com todos os campos `string().nullable()`.
- [ ] **Step 4:** Rodar → PASS.
- [ ] **Step 5: Commit** `feat(address): endereço por CEP e por texto livre`

---

### Task 6: Módulo `customer`

**Files:**
- Create: `src/modules/customer/customer.repository.ts`, `customer.repository.spec.ts`, `customer.module.ts`

**Interfaces:**
- Consumes: `REVGAS_CLIENT`, tipos da Task 4
- Produces:
  ```ts
  @Injectable() export class CustomerRepository {
    findByPhone(phone: string): Promise<Customer | null>;
    create(input: NewCustomer): Promise<Customer>;          // RevgasDuplicateError → CpfTakenError; RevgasValidationError → CustomerRejectedError (ambos de customer.types.ts)
    saveCpf(customerId: number, cpf: string): Promise<void>;
    history(customerId: number): Promise<CustomerHistory>;
  }
  ```

- [ ] **Step 1: Testes que falham** (com `FakeRevgasClient` e `seedCustomers`):
  - `findByPhone('5586999990000')` encontra o cliente; vários com o mesmo telefone → o de `last_sale` mais recente; nenhum → `null`.
  - `create` envia `phones: ['5586999990000']`, CPF só com dígitos e o endereço nos campos da RevGás (`location`, `number`, `neighborhood`, `city`, `state_federation`, `complement`, `landmark`, `postal_code`).
  - `create` com `RevgasDuplicateError` → lança `CpfTakenError`; com `RevgasValidationError` → lança `CustomerRejectedError`.
  - `history` junta o endereço do cadastro (se completo) com os das últimas 20 vendas (`sales.list({ customer_id, page_size: 20 })`), sem repetir (comparação por rua+número+bairro normalizados); o do cadastro vem primeiro. `productIds` = ids dos produtos dessas vendas, sem repetir, na ordem em que aparecem.
  - Endereço sem rua, número ou bairro não entra na lista.
- [ ] **Step 2:** Rodar → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar → PASS.
- [ ] **Step 5: Commit** `feat(customer): repositório de clientes da RevGás`

---

### Task 7: Módulo `catalog`

**Files:**
- Create: `src/modules/catalog/catalog.repository.ts`, `catalog.repository.spec.ts`, `catalog.module.ts`

**Interfaces:**
- Consumes: `REVGAS_CLIENT`, `RedisService`, `pickDeal`, `paymentLabel` (Task 4)
- Produces:
  ```ts
  @Injectable() export class CatalogRepository {
    listProducts(customer: PriceCustomer): Promise<Product[]>;            // ordem alfabética
    listPaymentOptions(): Promise<PaymentOption[]>;
    quote(customer: PriceCustomer, productId: number, paymentType: string, quantity: number): Promise<Quote | null>;
  }
  ```

- [ ] **Step 1: Testes que falham:**
  - `listProducts` esconde inativos, os sem acordo aplicável em nenhuma forma de pagamento ativa e, se o estabelecimento **não** tem `ignore_stock_check`, os com `stock_quantity <= 0`.
  - Com `ignore_stock_check: true`, produto sem estoque aparece.
  - Estabelecimento = o de `id === REVGAS_ESTABLISHMENT_ID`, ou o primeiro da lista se a env não estiver definida.
  - `listPaymentOptions` só `status === 'ACTIVE'`, com `paymentLabel`.
  - `quote` usa `suggested_value` do `pickDeal`: `unitPrice` e `total = unitPrice × quantity` arredondado em centavos; sem acordo → `null`.
  - Cache: segunda chamada dentro de 600 s não chama a RevGás de novo (chaves `catalog:products`, `catalog:payment-types`, `catalog:deals` via `deals.listAll()`, `catalog:establishment`).
- [ ] **Step 2:** Rodar → FAIL.
- [ ] **Step 3:** Implementar. Ler cache com `RedisService.get`; se vazio, buscar e `set` com `ttl: 600`.
- [ ] **Step 4:** Rodar → PASS.
- [ ] **Step 5: Commit** `feat(catalog): produtos, formas de pagamento e preço com cache`

---

### Task 8: Módulo `order`

**Files:**
- Create: `src/modules/order/order.repository.ts`, `order.repository.spec.ts`, `order.module.ts`

**Interfaces:**
- Consumes: `REVGAS_CLIENT`, `SaleOrder`
- Produces:
  ```ts
  @Injectable() export class OrderRepository {
    createSale(order: SaleOrder): Promise<number>;                         // id da venda
    findRecentSale(order: SaleOrder, since: Date): Promise<number | null>;
  }
  ```

- [ ] **Step 1: Testes que falham:**
  - `createSale` envia endereço, `customer_id`, `products: [{ product_id, quantity, value: unitPrice, product_description }]`, `payments: [{ payment_type, value: total }]`, `channel: 'WHATSAPP'` e `observation` quando houver; devolve o `id`.
  - `createSale` **não** repete em erro (uma chamada a `sales.create` mesmo com `RevgasUnavailableError`, que é relançado).
  - `findRecentSale` lista `sales.list({ customer_id, channel: 'WHATSAPP', from: <data de since em YYYY-MM-DD> })` e devolve o id da venda com o mesmo `total` e `date >= since - 60 s` (se `date` faltar ou não for uma data válida, compara só o `total`); nenhuma → `null`.
- [ ] **Step 2:** Rodar → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar → PASS.
- [ ] **Step 5: Commit** `feat(order): criação de venda e busca anti-duplicata`

---

### Task 9: Base do fluxo (tipos, textos, comandos globais, `runFlow`)

**Files:**
- Create: `src/modules/conversation/flow/flow.types.ts`, `input.ts`, `messages.ts`, `global-commands.ts`, `next-step.ts`, `flow.ts`, `steps/index.ts`, `testing/fake-tools.ts`
- Test: `src/modules/conversation/flow/global-commands.spec.ts`, `input.spec.ts`, `flow.spec.ts`

**Interfaces:**
- Consumes: tipos da Task 4, `Reply`/`IncomingContent` de `conversation/contracts/conversation.types.ts`
- Produces:
  ```ts
  // flow.types.ts
  export type Step =
    | 'askName' | 'askCpf' | 'askMissingCpf'
    | 'chooseAddress' | 'askNewAddress' | 'askAddressField' | 'confirmAddress'
    | 'chooseProduct' | 'searchProduct' | 'chooseQuantity' | 'askQuantity'
    | 'choosePayment' | 'askNeedsChange' | 'askChangeAmount'
    | 'summary' | 'chooseCorrection' | 'creatingSale' | 'saleFailed';
  export interface OrderState {
    step: Step;
    customer: { id?: number; name?: string; cpf?: string; tagId?: number | null };
    addresses?: Address[];
    boughtProductIds?: number[];
    draftAddress?: AddressDraft;
    missingField?: AddressField;
    address?: Address;
    productOptions?: Product[];
    product?: Product;
    quantity?: number;
    paymentOptions?: PaymentOption[];
    payment?: PaymentOption;
    quote?: Quote;
    changeFor?: number | null;      // null = não precisa; undefined = não perguntado
    saleAttemptAt?: string;          // ISO
  }
  export interface FlowInput { phone: string; content: IncomingContent }
  export interface StepResult { state: OrderState | null; replies: Reply[] }
  export type AskFn = (state: OrderState, tools: FlowTools) => Promise<StepResult>;
  export type HandleFn = (state: OrderState, input: FlowInput, tools: FlowTools) => Promise<StepResult>;
  export interface FlowTools {
    findCustomer(phone: string): Promise<Customer | null>;
    createCustomer(input: NewCustomer): Promise<Customer>;        // lança CpfTakenError
    saveCpf(customerId: number, cpf: string): Promise<void>;
    customerHistory(customerId: number): Promise<CustomerHistory>;
    addressFromCep(cep: string): Promise<AddressDraft | null>;
    addressFromText(text: string): Promise<AddressDraft | null>;
    listProducts(customer: PriceCustomer): Promise<Product[]>;
    listPaymentOptions(): Promise<PaymentOption[]>;
    quote(customer: PriceCustomer, productId: number, paymentType: string, quantity: number): Promise<Quote | null>;
    createSale(order: SaleOrder): Promise<number>;
    findRecentSale(order: SaleOrder, since: Date): Promise<number | null>;
    checkpoint(state: OrderState): Promise<void>;                 // salva o estado no meio de uma etapa
    storePhone?: string;
    now(): Date;
  }
  // input.ts
  export function textOf(input: FlowInput): string | null;                 // texto cru, ou null se não for texto
  export function choiceOf(input: FlowInput, prefix: string): string | null; // 'product:12' + 'product' → '12'
  export function fit(text: string, max: number): string;                  // corta em max-1 + '…'
  // global-commands.ts
  export function globalCommand(state: OrderState | null, input: FlowInput, tools: FlowTools): Promise<StepResult | null>;
  // next-step.ts
  export function nextStep(state: OrderState, tools: FlowTools): Promise<StepResult>;
  // flow.ts
  export function runFlow(state: OrderState | null, input: FlowInput, tools: FlowTools): Promise<StepResult>;
  // testing/fake-tools.ts
  export function createFakeTools(overrides?: Partial<FlowTools>): FlowTools;  // dados de exemplo prontos
  ```

**Regras do `runFlow`** (nesta ordem):
1. `globalCommand` → se devolveu resultado, usa.
2. `state === null` → `customerSteps.start(input, tools)` (Task 10; nesta task, um stub que a Task 10 substitui).
3. `handlers[state.step](state, input, tools)`; os mapas `asks` e `handlers` vêm de `steps/index.ts`, que junta os de todos os arquivos de etapa (nesta task começa vazio; cada task de etapa acrescenta o seu arquivo).
4. Qualquer erro lançado por `tools` (exceto os tratados nas etapas) → `{ state, replies: [text(msg.unavailable)] }` (estado mantido).

**Regras do `globalCommand`** (só para texto; compara com `normalizeText`):
- Texto igual a `cancelar`, `cancela` ou `cancelar pedido` → `{ state: null, replies: [msg.cancelled] }`.
- Contém `atendente`, `falar com alguem`, `humano` → `[msg.talkToStore(tools.storePhone)]`, estado igual.
- Contém `desconto`, `promocao`, `mais barato` → `[msg.noDiscount]` + a pergunta da etapa atual (`asks[state.step]`), estado igual. Sem estado → só `msg.noDiscount`.
- `content.type === 'unsupported'` → `[msg.textOnly]` + a pergunta da etapa atual; sem estado → `start`.

**`nextStep`** decide o que falta, nesta ordem: sem `address` → `chooseAddress` (se `addresses` não vazio) ou `askNewAddress`; sem `product` → `chooseProduct`; sem `quantity` → `chooseQuantity`; sem `payment` → `choosePayment`; sem `quote` → calcula com `tools.quote` (se `null`: limpa `payment` e devolve `msg.noPriceForPayment` + `choosePayment`); `payment.type === 'MONEY'` e (`changeFor === undefined` ou (`changeFor !== null` e `changeFor <= quote.total`)) → `askNeedsChange`; senão → `summary`. Para ir a uma etapa usa `asks[step]`; se a etapa ainda não estiver registrada (só acontece durante as Tasks 10–12), devolve `{ state: { ...state, step }, replies: [] }`. **A correção do resumo usa isto:** limpa o que vai ser refeito e chama `nextStep`.

**Textos (`messages.ts`)**, exportados como `export const msg = { … }` (constantes e funções). Copiar do spec os textos já fixados ali (cadastro, endereço, troco, resumo, sucesso, falha, comandos globais). Chaves: `welcomeNew`, `welcomeBack(name)`, `askName`, `invalidName`, `askCpf`, `invalidCpf`, `askMissingCpf`, `cpfTaken(phone?)`, `registerFailed`, `chooseAddress(addresses)`, `askNewAddress`, `cepNotFound`, `askStreet`, `askNumber`, `askNeighborhood`, `didNotUnderstandAddress`, `confirmAddress(address)`, `chooseProduct`, `askProductSearch`, `productNotFound`, `chooseQuantity(product)`, `askQuantity`, `invalidQuantity`, `choosePayment`, `noPriceForPayment`, `askNeedsChange(total)`, `askChangeAmount`, `invalidChange(total)`, `summary(state)`, `chooseCorrection`, `saleCreated(id)`, `saleFailed`, `saleInProgress`, `cancelled`, `talkToStore(phone?)`, `noDiscount`, `textOnly`, `unavailable`, `addressLabel(address)` (`Rua, número – Bairro`), `addressFull(address)` (+ `, Cidade/UF`).

- [ ] **Step 1: Testes que falham:**
  - `input.spec.ts`: `choiceOf` com prefixo errado → `null`; `textOf` de escolha → `null`; `fit('abcdef', 4) === 'abc…'`.
  - `global-commands.spec.ts`: um teste por regra acima (incluindo "Cancelar" com acento/maiúscula e áudio sem estado → saudação).
  - `flow.spec.ts` (este arquivo cresce nas Tasks 10–13): com um handler registrado só no teste não é possível; aqui testar `runFlow` com `state === null` chamando `start` (stub) e um `tools` que lança → `msg.unavailable` com estado mantido.
- [ ] **Step 2:** Rodar → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm test src/modules/conversation/flow` → PASS.
- [ ] **Step 5: Commit** `feat(conversation): base do fluxo de pedido`

**Formato de todo arquivo de etapa (Tasks 10–13):** começa com a lista de estados que trata; exporta `asks: Partial<Record<Step, AskFn>>` e `handlers: Partial<Record<Step, HandleFn>>`; funções nomeadas `ask<Estado>` e `handle<Estado>`. Entrada que não serve → devolve `asks[state.step]` (repete a pergunta). Até ~200 linhas por arquivo.

---

### Task 10: Etapa do cliente (`customer.step.ts`)

**Files:** Create `flow/steps/customer.step.ts`, `customer.step.spec.ts`; Modify `flow/flow.ts` (trocar o stub)

**Interfaces:**
- Produces: `start(input: FlowInput, tools: FlowTools): Promise<StepResult>`; `asks`/`handlers` de `askName`, `askCpf`, `askMissingCpf`.

**Comportamento:**
- `start`: `findCustomer(phone)`. Nulo → `msg.welcomeNew` + `askName`. Sem CPF → `msg.welcomeBack(nome)` + `askMissingCpf`. Com CPF → `msg.welcomeBack(nome)` + carrega `customerHistory` (endereços e `boughtProductIds`) + `nextStep`.
- `askName`: ≥ 2 palavras, cada uma com letras, total ≤ 100 caracteres → guarda `customer.name`, vai para `askCpf`. Senão `msg.invalidName`.
- `askCpf`: `isValidCpf` → guarda só dígitos em `customer.cpf` e `nextStep` (vai para `askNewAddress`, pois não há endereços). Senão `msg.invalidCpf` (o texto **não** contém o número digitado).
- `askMissingCpf`: válido → `saveCpf(id, cpf)` + `customerHistory` + `nextStep`.

- [ ] **Step 1: Testes que falham** (um por comportamento acima, com `createFakeTools`).
- [ ] **Step 2:** Rodar → FAIL. **Step 3:** Implementar. **Step 4:** Rodar → PASS.
- [ ] **Step 5: Commit** `feat(conversation): etapa de identificação e cadastro`

---

### Task 11: Etapa do endereço (`address.step.ts`)

**Files:** Create `flow/steps/address.step.ts`, `address.step.spec.ts`

**Interfaces:** `asks`/`handlers` de `chooseAddress`, `askNewAddress`, `askAddressField`, `confirmAddress`.

**Comportamento:**
- `chooseAddress`: ≤ 2 endereços → botões `address:<índice>` (título `fit(addressLabel, 20)`) + `address:new` ("Outro endereço"), com os endereços completos numerados no corpo; > 2 → lista com até 9 (`fit(label, 24)`, descrição `fit(addressFull, 72)`) + `address:new`. Escolha → `address` = o escolhido, `nextStep`. `address:new` → `askNewAddress`.
- `askNewAddress`: texto que é só CEP (`/^\s*\d{5}-?\d{3}\s*$/`) → `addressFromCep`; `null` → `msg.cepNotFound`; ok → `draftAddress` e `askAddressField` com `missingField = 'number'`. Outro texto → `addressFromText`; `null` → `msg.didNotUnderstandAddress` (pede o CEP), continua em `askNewAddress`; ok → se falta campo, `askAddressField`; senão `confirmAddress`.
- `askAddressField`: `number` aceita `/^(\d+[a-zA-Z]?)\s*[,\-]?\s*(.*)$/` (resto vira `complement`) ou `s/n`/`sn` → `'S/N'`; outros campos aceitam texto não vazio. Depois o próximo campo faltante ou `confirmAddress`.
- `confirmAddress`: botões `address:ok` ("Está certo") e `address:retype` ("Corrigir"). `retype` → limpa `draftAddress`, `askNewAddress`. `ok` → se `customer.id` não existe, `createCustomer({ phone, name, cpf, address })`: `CpfTakenError` → `{ state: null, replies: [msg.cpfTaken(storePhone)] }`; `CustomerRejectedError` → `msg.registerFailed` e volta para `askName` com `customer` vazio. Depois guarda `address`, limpa `draftAddress`, `nextStep`.

- [ ] **Step 1: Testes que falham** (um por comportamento; incluir CEP com traço, "120 apto 3", "s/n", IA devolvendo `null`).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(conversation): etapa de endereço`

---

### Task 12: Etapas de produto e pagamento (`product.step.ts`, `payment.step.ts`)

**Files:** Create `flow/steps/product.step.ts`, `product.step.spec.ts`, `flow/steps/payment.step.ts`, `payment.step.spec.ts`

**Comportamento — produto:**
- `chooseProduct`: `listProducts({ id, tagId })`, reordenado com `boughtProductIds` primeiro (na ordem do histórico) e o resto como veio. ≤ 10 → todos na lista (`product:<id>`); > 10 → 9 + `product:search` ("Buscar pelo nome"). Guarda `productOptions`. Lista vazia → `msg.unavailable`, estado mantido.
- `searchProduct`: filtra `productOptions` (carregando de novo se faltar) por `normalizeText(name).includes(normalizeText(texto))`; nada → `msg.productNotFound` e continua em `searchProduct`; achou → lista com até 10.
- Escolha de produto → `product`, limpa `quantity` e `quote`, vai para `chooseQuantity` (na correção, produto e quantidade são refeitos juntos).
- `chooseQuantity`: botões `qty:1`, `qty:2`, `qty:other` ("Outra"). `other` → `askQuantity`: inteiro ≥ 1 (`/^\d+$/`), senão `msg.invalidQuantity`. Ao definir: limpa `quote` e `nextStep`.

**`flow.spec.ts` (acrescentar nesta task):**
- **Review Focus 5:** etapa `choosePayment`, `listPaymentOptions` lançando → resposta `msg.unavailable` e estado igual ao de entrada.
- **Review Focus 1:** estado `choosePayment`, entrada `{ type: 'choice', id: 'product:12' }` → repete `choosePayment`, estado igual.

**Comportamento — pagamento:**
- `choosePayment`: `listPaymentOptions()`; ≤ 3 → botões `pay:<TYPE>`; > 3 → lista. Escolha → `payment`, limpa `quote` e `changeFor`, `nextStep`.
- `askNeedsChange`: corpo `msg.askNeedsChange(total)`, botões `change:no` / `change:yes`. `no` → `changeFor = null`, `nextStep`. `yes` → `askChangeAmount`.
- `askChangeAmount`: `parseMoney`; precisa ser `> quote.total`, senão `msg.invalidChange(total)`. Ok → `changeFor`, `nextStep`.

- [ ] **Step 1: Testes que falham** (11 produtos → 9 + busca; cliente que comprou o produto 7 vê o 7 primeiro; busca "p13" acha "Botijão P13"; quantidade "0" e "abc" recusadas; 4 formas → lista; troco 200 com total 220 recusado; `quote` nulo → `msg.noPriceForPayment` e volta a `choosePayment`).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(conversation): etapas de produto e pagamento`

---

### Task 13: Etapa do resumo e conversas completas (`summary.step.ts`)

**Files:** Create `flow/steps/summary.step.ts`, `summary.step.spec.ts`; Modify `flow/flow.spec.ts`

**Comportamento:**
- `summary`: corpo `msg.summary(state)` (produto × quantidade, `addressLabel`, forma de pagamento com "(troco para R$ X)" se houver, total); botões `summary:confirm` / `summary:fix`.
- `summary:fix` → `chooseCorrection`: botões `fix:product`, `fix:address`, `fix:payment`. `product` → limpa `product`, `quantity`, `quote`; `address` → limpa `address`; `payment` → limpa `payment`, `quote`, `changeFor`. Depois `nextStep`. (Correção de produto: se a forma é dinheiro e `changeFor <= novo total`, `nextStep` já pergunta o troco de novo.)
- `summary:confirm` → estado `creatingSale` com `saleAttemptAt = now()` **salvo antes** de chamar `createSale`. Sucesso → `{ state: null, replies: [msg.saleCreated(id)] }`. Erro → estado `saleFailed`, `[msg.saleFailed]` com botão `retry:sale` ("Tentar de novo").
- `creatingSale` (qualquer entrada) → `[msg.saleInProgress]`, estado igual.
- `saleFailed` + `retry:sale` → `findRecentSale(order, saleAttemptAt)`; achou → `msg.saleCreated(id)` e estado `null`; não achou → tenta `createSale` de novo (mesmo caminho do confirmar).
- `observation` = `Troco para R$ X` quando `changeFor` é número.
- O "salvo antes" usa `tools.checkpoint(state)` (Task 9; no fake, registra a chamada).

- [ ] **Step 1: Testes que falham:**
  - `summary.step.spec.ts`: um por comportamento acima; `checkpoint` chamado com `step: 'creatingSale'` antes de `createSale`.
  - **Review Focus 2:** estado `creatingSale` + `summary:confirm` → `createSale` não é chamado.
  - **Review Focus 4:** total 220, troco 250, correção de produto para quantidade 2 (total 440) → próxima pergunta é o troco.
  - `flow.spec.ts` — conversas de ponta a ponta com `createFakeTools`: cliente novo (oi → nome → CPF → CEP → número → confirma → produto → qtd 2 → dinheiro → troco 250 → confirmar → venda); cliente cadastrado (oi → endereço 1 → produto → 1 → Pix → confirmar); correção de endereço volta ao resumo; falha e "Tentar de novo" encontrando a venda; "cancelar" no meio.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** `pnpm test src/modules/conversation` → PASS.
- [ ] **Step 5: Commit** `feat(conversation): resumo, correção e criação da venda`

---

### Task 14: Ligar o fluxo ao WhatsApp

**Files:**
- Create: `src/modules/conversation/flow-tools.ts`, `flow-tools.spec.ts`
- Modify: `conversation.repository.ts` (+ spec), `conversation.service.ts` (+ spec), `conversation.module.ts`
- Modify: `src/config/env.ts`, `.env.example`, `docs/guides/conventions/environment.md` (`STORE_PHONE`, opcional, texto livre, ex.: `(86) 3222-0000`; sem ela, `msg.talkToStore` e `msg.cpfTaken` dizem só "fale direto com a revenda")
- Modify: `tests/conversation/whatsapp-webhook.e2e.spec.ts`

**Interfaces:**
- Consumes: Tasks 5–9, 13
- Produces:
  ```ts
  @Injectable() export class FlowToolsService { forPhone(save: (s: OrderState) => Promise<void>): FlowTools }
  // ConversationRepository
  loadOrder(phone: string): Promise<OrderState | null>;
  saveOrder(phone: string, state: OrderState): Promise<void>;   // ttl 900
  clearOrder(phone: string): Promise<void>;
  withPhoneLock<T>(phone: string, work: () => Promise<T>): Promise<T>;
  ```
  Prefixos: `conversation:order`, `conversation:lock`.

**Comportamento:**
- `withPhoneLock`: `setIfAbsent` com TTL 30 s; se ocupado, tenta de novo a cada 250 ms por até 30 s; depois segue mesmo assim com `warn` no log. Sempre libera no `finally` com `delete`.
- `ConversationService.onMessage`: depois de dedup e `markAsRead`, dentro de `withPhoneLock(from)`: `loadOrder` → `runFlow(state, { phone: from, content }, tools)` → `state === null ? clearOrder : saveOrder` → envia as respostas. Remover `replyTo`, `listDemo`, `buttonsDemo`.
- Logs: etapa antes/depois e tipo de entrada; nunca o texto do cliente, CPF ou endereço.
- `ConversationModule` importa `CustomerModule`, `CatalogModule`, `OrderModule`, `AddressModule`, `RevgasModule`, `LlmModule`, `ViacepModule`, `CacheModule`.

- [ ] **Step 1: Testes que falham:**
  - `conversation.repository.spec.ts`: `saveOrder` usa TTL 900; `withPhoneLock` serializa duas chamadas simultâneas do mesmo telefone (a segunda começa só depois da primeira terminar).
  - `conversation.service.spec.ts`: mensagem → `runFlow` com o estado carregado; resultado `null` → `clearOrder`; respostas enviadas na ordem.
  - E2e (WhatsApp, RevGás, IA e ViaCEP em `fake`): "oi" de um telefone novo → bot responde `msg.welcomeNew`/`askName`; "cancelar" → `msg.cancelled`. Limpar as chaves `conversation:order:<telefone>` no `afterAll`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** `pnpm test` e `pnpm test:e2e` → PASS; `pnpm lint` → limpo; `pnpm build` → ok.
- [ ] **Step 5: Commit** `feat(conversation): fluxo de pedido ligado ao webhook`

---

### Task 15: Documentação

**Files:** Modify `CLAUDE.md`, `docs/project/fluxo.md`, `docs/README.md`, `docs/guides/integrations/whatsapp.md` (seção que fala do `replyTo` de teste)

- [ ] **Step 1:** `CLAUDE.md`: árvore de `modules/` (conversation/flow, customer, catalog, order, address), `integrations/viacep`, e trocar a regra "pure function … no I/O" por: etapas em `flow/steps/` recebem `FlowTools` e não importam Nest, Redis nem integrações; testáveis com `createFakeTools`. Remover "for now a test reply: echo, lista, botões". Adicionar o guia ViaCEP ao índice.
- [ ] **Step 2:** `fluxo.md`: tabela de estados com os nomes de `Step` desta entrega e a regra do `nextStep`.
- [ ] **Step 3:** `wc -l src/modules/conversation/flow/messages.ts` → se > 500, avisar o usuário.
- [ ] **Step 4:** `pnpm lint` → limpo.
- [ ] **Step 5: Commit** `docs: fluxo de pedido, ViaCEP e regra das etapas`
