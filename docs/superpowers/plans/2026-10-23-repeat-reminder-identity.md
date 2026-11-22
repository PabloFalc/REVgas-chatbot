# Repetir pedido (F04), lembrete (F12) e verificação de identidade (F14) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cliente cadastrado confirma os 3 primeiros dígitos do CPF, pode repetir o último pedido em
2 toques, e recebe um lembrete aos 10 min parado.

**Architecture:** As regras ficam em `flow/` (funções puras com `FlowTools`, testáveis com
`createFakeTools`). Estado de identidade (verificado, tentativas, bloqueio) e agenda do lembrete
ficam no Redis via `ConversationRepository`. Um provider novo (`ReminderScheduler`) varre a agenda a
cada 30 s e usa o fluxo puro para montar o lembrete.

**Tech Stack:** NestJS 11, ioredis, Vitest, Biome. pnpm.

**Spec:** `docs/superpowers/specs/2026-10-23-repeat-reminder-identity-design.md`

## Global Constraints

- Sem comentários `//` explicativos no código (CLAUDE.md).
- Arquivos de `flow/` e `flow/steps/` não importam Nest, Redis, integrações, serviços nem repositórios
  (só arquivos do fluxo, `src/utils` e `contracts/` dos módulos).
- CPF (inteiro ou os dígitos digitados) nunca em log, resposta do bot ou prompt da IA. Telefone nos
  logs sempre com `maskPhone`.
- Textos sem emoji, em `flow/messages.ts`.
- Valores fixos: verificação **15 dias** (`1_296_000` s); bloqueio **1 h** (`3_600` s) depois de
  **3** erros; janela de tentativas 1 h; lembrete aos **10 min** (`600_000` ms) sem mensagem do
  cliente; varredura a cada **30 s**; pedido continua com TTL de **900 s**.
- O lembrete não renova o TTL do pedido. Só mensagem do cliente renova.
- "Repetir" nunca cria venda: vai para `nextStep` (resumo ou troco), com preço de `tools.quote`.
- Commits: conventional commits, **sem** linhas `Co-Authored-By`/`Claude-Session` (preferência do
  usuário).
- Ao fim de cada task: `pnpm lint` e `pnpm test` verdes.

## Review Focus

1. **Cliente digita o CPF inteiro em `askCpfPrefix`** → não conta tentativa, repete o pedido dos 3
   dígitos (teste na Task 3).
2. **Cliente manda mensagem bem na hora em que o lembrete é varrido** → nenhum lembrete para essa
   mensagem nova, e o agendamento novo não é apagado (claim com conferência de score, Task 2; checagem
   `lastInboundAt`, Task 5).
3. **"cancelar" depois de 2 erros** não zera as tentativas (contador fora do `OrderState`, Task 2/3).
4. **Última venda paga em dinheiro** → "Repetir" pergunta o troco antes do resumo (Task 4).
5. **Lembrete salvo com `set`/`setex` comum** reiniciaria os 15 min → teste que exige `KEEPTTL`
   (Task 1/2).

---

## Mapa de arquivos

| Arquivo | Papel |
| --- | --- |
| `src/infra/cache/redis.service.ts` (+spec) | Métodos novos: `setKeepTtl`, `increment`, `scheduleAdd`, `scheduleDue`, `scheduleClaim`, `scheduleRemove` |
| `src/modules/conversation/conversation.repository.ts` (+spec) | Identidade (verificado/tentativas/bloqueio), agenda do lembrete, `saveOrderKeepingTtl`, `tryPhoneLock` |
| `src/modules/conversation/flow/flow.types.ts` | `Step` novos, campos novos do `OrderState`, tools novas, remove `saveCpf` |
| `src/modules/conversation/flow/steps/customer.step.ts` (+spec) | `start()` com F14, etapa `askCpfPrefix`, remove `askMissingCpf` |
| `src/modules/conversation/flow/steps/repeat.step.ts` (+spec) — **novo** | F04: `offerOrNext`, etapa `offerRepeat` |
| `src/modules/conversation/flow/reminder.ts` (+spec) — **novo** | F12: `reminderFor` (puro) |
| `src/modules/conversation/reminder.scheduler.ts` (+spec) — **novo** | Varredura a cada 30 s, envio do lembrete |
| `src/modules/conversation/conversation.service.ts` (+spec) | Marca `lastInboundAt` e agenda/cancela o lembrete |
| `src/modules/customer/customer.repository.ts` (+spec), `customer/contracts/customer.types.ts` | `history()` devolve `lastOrder`; remove `saveCpf` |
| `src/modules/conversation/flow-tools.ts` (+spec), `flow/testing/fake-tools.ts` | Liga as tools novas |
| docs + `CLAUDE.md` | Task 6 |

---

### Task 1: Primitivas novas no `RedisService`

**Files:**
- Modify: `src/infra/cache/redis.service.ts`
- Test: `src/infra/cache/redis.service.spec.ts`

**Interfaces:**
- Produces (todos com `prefix`/`key` → chave `${prefix}:${key}`, como os métodos atuais; erros **propagam**, como em `setIfAbsent` — o chamador decide):
  - `setKeepTtl(params: CacheGetParams & { value: unknown }): Promise<void>` → `SET key json KEEPTTL XX`
  - `increment(params: CacheGetParams & { ttl: number }): Promise<number>` → `INCR`; se o resultado for 1, `EXPIRE key ttl`. Retorna o valor.
  - `scheduleAdd(params: { set: string; member: string; at: number }): Promise<void>` → `ZADD set at member`
  - `scheduleDue(params: { set: string; upTo: number; limit: number }): Promise<{ member: string; at: number }[]>` → `ZRANGEBYSCORE set -inf upTo WITHSCORES LIMIT 0 limit`
  - `scheduleClaim(params: { set: string; member: string; at: number }): Promise<boolean>` → Lua: remove o membro só se `ZSCORE` == `at`; true se removeu.
  - `scheduleRemove(params: { set: string; member: string }): Promise<void>` → `ZREM`

- [ ] **Step 1: Escrever os testes** (mock de `ioredis` como no spec atual)
  - `setKeepTtl grava com KEEPTTL e XX`: `expect(set).toHaveBeenCalledWith('p:k', '{"a":1}', 'KEEPTTL', 'XX')`.
  - `increment define TTL só na primeira vez`: `incr` → 1 ⇒ `expire('p:k', 3600)` chamado; `incr` → 2 ⇒ `expire` não chamado; retorna o valor de `incr`.
  - `scheduleDue converte WITHSCORES em pares`: `zrangebyscore` → `['5586…', '1000', '5587…', '2000']` ⇒ `[{ member: '5586…', at: 1000 }, { member: '5587…', at: 2000 }]`; chamado com `('s', '-inf', 5000, 'WITHSCORES', 'LIMIT', 0, 50)`.
  - `scheduleClaim devolve true só quando o eval remove`: `eval` → 1 ⇒ true; 0 ⇒ false.
  - `scheduleAdd` / `scheduleRemove` chamam `zadd('s', 1000, 'm')` / `zrem('s', 'm')`.
- [ ] **Step 2:** `pnpm test src/infra/cache/redis.service.spec.ts` → FAIL (métodos não existem).
- [ ] **Step 3:** Implementar os 6 métodos. Lua do claim: `if redis.call('zscore', KEYS[1], ARGV[1]) == ARGV[2] then return redis.call('zrem', KEYS[1], ARGV[1]) else return 0 end` (passar `at` como string).
- [ ] **Step 4:** Rodar de novo → PASS. `pnpm lint`.
- [ ] **Step 5:** `git commit -m "feat(cache): keepttl, contador e agenda em sorted set no RedisService"`

---

### Task 2: `ConversationRepository` — identidade, agenda e lock sem espera

**Files:**
- Modify: `src/modules/conversation/conversation.repository.ts`
- Test: `src/modules/conversation/conversation.repository.spec.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces (constantes exportadas: `VERIFIED_PREFIX = 'conversation:verified'`, `CPF_ATTEMPTS_PREFIX = 'conversation:cpf-attempts'`, `BLOCKED_PREFIX = 'conversation:cpf-blocked'`, `REMINDER_SET = 'conversation:reminders'`, `MAX_CPF_ATTEMPTS = 3`):
  - `isVerified(phone: string, customerId: number): Promise<boolean>` — chave `${phone}:${customerId}`.
  - `markVerified(phone: string, customerId: number): Promise<void>` — grava com TTL 1_296_000 e apaga o contador de tentativas.
  - `registerCpfMismatch(phone: string): Promise<number>` — `increment` com TTL 3_600; ao chegar em `MAX_CPF_ATTEMPTS`, grava `BLOCKED_PREFIX` com TTL 3_600. Retorna a contagem.
  - `isBlocked(phone: string): Promise<boolean>`.
  - `saveOrderKeepingTtl(phone: string, state: OrderState): Promise<void>` — `setKeepTtl`.
  - `scheduleReminder(phone: string, at: Date): Promise<void>` / `cancelReminder(phone: string): Promise<void>`.
  - `dueReminders(now: Date, limit = 50): Promise<{ phone: string; at: number }[]>`.
  - `claimReminder(phone: string, at: number): Promise<boolean>`.
  - `tryPhoneLock<T>(phone: string, work: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }>` — uma tentativa de `setIfAbsent` no `LOCK_PREFIX` (mesmo TTL 120 s), sem esperar; libera com `deleteIfEquals` como `withPhoneLock`.
- Logs (com `maskPhone`, `component: 'conversation'`): `markVerified` → info "Identidade confirmada"; `registerCpfMismatch` → warn "CPF não confere" com `{ attempts }`; bloqueio → warn "Telefone bloqueado por tentativas de CPF". Nunca os dígitos.

- [ ] **Step 1: Testes** (estender o `setupStore` do spec ou mock do cache)
  - `isVerified depende do par telefone+cliente`: `markVerified('5586…', 1)` ⇒ `isVerified('5586…', 1)` true e `isVerified('5586…', 2)` false; `set` chamado com `ttl: 1_296_000`.
  - `terceiro erro bloqueia por 1 hora`: 1º e 2º retornam 1 e 2 sem gravar bloqueio; 3º retorna 3 e grava `BLOCKED_PREFIX` com `ttl: 3_600`; `isBlocked` true.
  - `markVerified apaga as tentativas`: `delete` com `CPF_ATTEMPTS_PREFIX`.
  - `saveOrderKeepingTtl usa setKeepTtl e nunca set`.
  - `scheduleReminder grava at em ms`: `scheduleAdd({ set: REMINDER_SET, member: phone, at: date.getTime() })`.
  - `tryPhoneLock com lock ocupado não roda o trabalho`: `setIfAbsent` → false ⇒ `{ ran: false }` e `work` não chamado; livre ⇒ `{ ran: true, value }` e `deleteIfEquals` chamado.
  - `logs de identidade não contêm o telefone cru`.
- [ ] **Step 2:** `pnpm test src/modules/conversation/conversation.repository.spec.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** → PASS. `pnpm lint`.
- [ ] **Step 5:** `git commit -m "feat(conversation): estado de identidade e agenda de lembrete no repositório"`

---

### Task 3: F14 — verificação pelos 3 primeiros dígitos do CPF

**Files:**
- Modify: `flow/flow.types.ts`, `flow/messages.ts`, `flow/steps/customer.step.ts`, `flow/free-text.ts`, `flow/testing/fake-tools.ts`, `flow-tools.ts` (todos em `src/modules/conversation/`), `src/modules/customer/customer.repository.ts`
- Test: `flow/steps/customer.step.spec.ts`, `flow/flow.spec.ts`, `flow/steps/free-text-fallback.spec.ts`, `flow-tools.spec.ts`, `src/modules/customer/customer.repository.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`isVerified`, `markVerified`, `registerCpfMismatch`, `isBlocked`, `MAX_CPF_ATTEMPTS`).
- Produces:
  - `Step`: adiciona `'askCpfPrefix'`, remove `'askMissingCpf'`.
  - `FlowTools`: adiciona `isVerified(phone, customerId): Promise<boolean>`, `markVerified(phone, customerId): Promise<void>`, `registerCpfMismatch(phone): Promise<number>`, `isBlocked(phone): Promise<boolean>`; remove `saveCpf`. `FlowToolsService` injeta `ConversationRepository` para ligá-las.
  - `createFakeTools` padrão: `isVerified` → **true**, `isBlocked` → false, `registerCpfMismatch` → 1, `markVerified` → undefined (assim os testes existentes de cliente conhecido continuam iguais).
  - `customer.step.ts` exporta `welcomeKnown(state: OrderState, tools: FlowTools): Promise<StepResult>` — boas-vindas com nome + `withHistory` + `keepOfferedProduct` + `nextStep` (a Task 4 troca `nextStep` por `offerOrNext`).
  - `msg`: `askCpfPrefix: 'Olá! Para sua segurança, digite os 3 primeiros dígitos do seu CPF.'`, `cpfPrefixMismatch: 'Não confere. Digite os 3 primeiros dígitos do seu CPF.'`, `cpfPrefixFormat: 'Digite só os 3 primeiros dígitos do seu CPF.'`, `identityContactStore: (phone?: string) => \`Não consegui confirmar seus dados por aqui. ${storeContact(phone)}\``. Remove `askMissingCpf`. **`cpfTaken` fica** (usado no cadastro em `address.step.ts`).
  - Remove `CustomerRepository.saveCpf` e seus testes.

Regras de `start()` para cliente encontrado (ordem): sem CPF → `identityContactStore`, `state: null`; `isBlocked` → idem; `isVerified(phone, id)` → `welcomeKnown`; senão → `{ step: 'askCpfPrefix', customer: { id, name, cpf, tagId }, ...seed }` com `[text(msg.askCpfPrefix)]` (sem nome, sem `customerHistory`).

Handler de `askCpfPrefix`: `onlyDigits(raw)` com exatamente 3 dígitos → compara com `customer.cpf.slice(0, 3)`; acerto → `markVerified` e `welcomeKnown`; erro → `registerCpfMismatch`; contagem `>= MAX_CPF_ATTEMPTS` → `identityContactStore`, `state: null`; senão `cpfPrefixMismatch` mantendo o estado. Qualquer outra entrada → `freeTextOr(state, raw, tools, msg.cpfPrefixFormat)` (não conta tentativa). `IDENTIFICATION_STEPS` passa a ser `['askName', 'askCpf', 'askCpfPrefix']`.

- [ ] **Step 1: Testes em `customer.step.spec.ts`** (substituir o teste "cliente sem CPF é recebido e o CPF é pedido" e os de `askMissingCpf`)
  - `cliente sem CPF recebe o contato da revenda`: `{ state: null, replies: [text(msg.identityContactStore('86999990000'))] }`; nenhuma resposta contém `'Joana'`.
  - `telefone bloqueado recebe o contato da revenda` (`isBlocked: async () => true`).
  - `não verificado pede os 3 dígitos sem mostrar o nome`: state `step: 'askCpfPrefix'`, replies `[text(msg.askCpfPrefix)]`; `JSON.stringify(replies)` não contém `'Maria'`; `calls` não inclui `customerHistory`; `isVerified` chamado com `(FAKE_PHONE, 1)`.
  - `verificado nos 15 dias segue como hoje`: mantém o teste atual (welcomeBack + chooseAddress).
  - `askCpfPrefix acerto`: entrada `'123'` (fake CPF `12345678909`) ⇒ `markVerified(FAKE_PHONE, 1)`, `replies[0]` = `welcomeBack('Maria da Silva')`, `step: 'chooseAddress'`.
  - `askCpfPrefix aceita "123." com pontuação` ⇒ acerto.
  - `askCpfPrefix erro 1 e 2`: `registerCpfMismatch` → 1 ⇒ `{ state, replies: [text(msg.cpfPrefixMismatch)] }`.
  - `askCpfPrefix terceiro erro encerra`: `registerCpfMismatch` → 3 ⇒ `{ state: null, replies: [text(msg.identityContactStore(...))] }`.
  - `CPF inteiro não conta tentativa`: entrada `'12345678909'` ⇒ `registerCpfMismatch` não chamado, `replies: [text(msg.cpfPrefixFormat)]`.
  - `texto de pedido em askCpfPrefix anota e repete a pergunta`: `interpret` → produto P13 com confiança 0.9 ⇒ replies `[noted, askCpfPrefix]`, `state.product` preenchido, `step: 'askCpfPrefix'`.
- [ ] **Step 2:** Ajustar `flow.spec.ts` (lista de steps na linha ~144, teste de `cpfTaken` via `saveCpf` na ~332 sai), `free-text-fallback.spec.ts` (`it.each(['askCpf', 'askCpfPrefix'])`), `flow-tools.spec.ts` (sai `saveCpf`, entram as 4 tools delegando ao repositório).
- [ ] **Step 3:** `pnpm test src/modules/conversation src/modules/customer` → FAIL.
- [ ] **Step 4:** Implementar.
- [ ] **Step 5:** → PASS. `pnpm lint`, `pnpm build`.
- [ ] **Step 6:** `git commit -m "feat(conversation): verificação de identidade pelos 3 primeiros dígitos do CPF (F14)"`

---

### Task 4: F04 — repetir último pedido

**Files:**
- Modify: `src/modules/customer/contracts/customer.types.ts`, `src/modules/customer/customer.repository.ts`, `flow/flow.types.ts`, `flow/messages.ts`, `flow/steps/customer.step.ts`, `flow/steps/index.ts`, `flow/testing/fake-tools.ts`
- Create: `flow/steps/repeat.step.ts`
- Test: `src/modules/customer/customer.repository.spec.ts`, `flow/steps/repeat.step.spec.ts`

**Interfaces:**
- Consumes: `welcomeKnown` (Task 3).
- Produces:
  - `customer.types.ts`: `interface LastOrder { productId: number; quantity: number; paymentType: string; address: Address }`; `CustomerHistory` ganha `lastOrder?: LastOrder`.
  - `OrderState` ganha `lastOrder?: LastOrder` (preenchido por `withHistory`) e `repeatOffer?: { product: Product; quantity: number; payment: PaymentOption; address: Address; quote: Quote }`. `Step` ganha `'offerRepeat'`.
  - `repeat.step.ts`: `offerOrNext(state: OrderState, tools: FlowTools): Promise<StepResult>`; `asks.offerRepeat`, `handlers.offerRepeat` registrados em `steps/index.ts`.
  - `msg.offerRepeat(offer)` → `'Quer repetir seu último pedido?\n{quantity}× {product.name} · {payment.label}\n{addressLabel(address)}'`; `msg.repeatOrder: 'Repetir'`, `msg.newOrder: 'Novo pedido'`. Botões `repeat:yes` / `repeat:new`.
  - Fake `customerHistory` padrão continua sem `lastOrder`.

`history()`: das vendas, ignora `status === 'CANCEL'`, ordena por `Date.parse((created_at ?? date).replace(' ', 'T'))` desc, com `id` desc como desempate (datas ausentes contam como mais antigas). Pega **só a primeira**; vira `lastOrder` se tiver exatamente 1 produto, 1 pagamento e `toAddress` não nulo. Senão, `lastOrder` fica ausente.

`offerOrNext`: oferece só se existe `state.lastOrder` **e** o estado não tem nenhum de `product`, `productCandidates`, `quantity`, `payment`, `address`, `draftAddress`, `pendingAddressText`; o produto está em `listProducts({ id, tagId })`; o pagamento está em `listPaymentOptions()`; `quote(...)` não é nulo. Senão → `nextStep(state, tools)`. Em `customer.step.ts`, `welcomeKnown` chama `offerOrNext` no lugar de `nextStep`.

Handler `offerRepeat`: `repeat:yes` → preenche `address`, `product`, `quantity`, `payment`, `quote` a partir de `repeatOffer` e chama `nextStep`; `repeat:new` → `nextStep` sem preencher; texto → `freeText(state, raw, tools)`; outra entrada → repete a pergunta.

- [ ] **Step 1: Testes de `history`** (fake RevGás como nos testes atuais)
  - `lastOrder vem da venda mais recente não cancelada`: duas vendas, a mais nova `status: 'CANCEL'` ⇒ `lastOrder` = a outra (`productId`, `quantity`, `paymentType: 'CASH'`, `address.street`).
  - `sem lastOrder quando a mais recente tem 2 produtos` (não cai para a anterior).
  - `sem lastOrder quando a venda não tem endereço completo`.
  - `ordena por created_at, não pela ordem da API`.
- [ ] **Step 2: Testes de `repeat.step.spec.ts`** (`lastOrder` = P13 ×1, PIX, Rua das Flores 120)
  - `oferece com o pedido e os botões`: reply `buttons(msg.offerRepeat(offer), [{ id: 'repeat:yes', title: 'Repetir' }, { id: 'repeat:new', title: 'Novo pedido' }])`; texto contém `'1× Botijão P13 · Pix'`.
  - `Repetir vai ao resumo com o preço do quote de hoje`: `step: 'summary'`, `quote.total` = 110, `createSale` **não** chamado.
  - `Repetir em dinheiro pergunta o troco`: `paymentType: 'MONEY'` ⇒ `step: 'askNeedsChange'`.
  - `Novo pedido segue o fluxo normal`: `step: 'chooseAddress'`, sem `product`.
  - `não oferece`: (a) produto fora de `listProducts`; (b) pagamento fora de `listPaymentOptions`; (c) `quote` → null; (d) estado já tem `product` vindo de texto livre — todos ⇒ mesmo resultado de `nextStep`.
  - `texto digitado na oferta passa pela IA`: `interpret` → quantidade 3 ⇒ `noted` presente e `quantity: 3`.
- [ ] **Step 3:** `pnpm test src/modules/customer src/modules/conversation/flow` → FAIL.
- [ ] **Step 4:** Implementar.
- [ ] **Step 5:** → PASS. `pnpm lint`, `pnpm build`.
- [ ] **Step 6:** `git commit -m "feat(conversation): oferta de repetir o último pedido (F04)"`

---

### Task 5: F12 — lembrete aos 10 minutos

**Files:**
- Create: `src/modules/conversation/flow/reminder.ts`, `src/modules/conversation/reminder.scheduler.ts`
- Modify: `flow/flow.types.ts`, `flow/messages.ts`, `conversation.service.ts`, `conversation.module.ts`
- Test: `flow/reminder.spec.ts`, `reminder.scheduler.spec.ts`, `conversation.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`scheduleReminder`, `cancelReminder`, `dueReminders`, `claimReminder`, `tryPhoneLock`, `saveOrderKeepingTtl`, `loadOrder`), `repeatQuestion`, `MessagingGateway.send`, `FlowToolsService.forPhone`.
- Produces:
  - `OrderState` ganha `lastInboundAt?: string` (ISO) e `remindedFor?: string`.
  - `flow/reminder.ts`: `export const REMINDER_AFTER_MS = 600_000`; `reminderFor(state: OrderState, tools: FlowTools): Promise<StepResult | null>` — null se `step === 'creatingSale'`, sem `lastInboundAt`, `tools.now() - lastInboundAt < REMINDER_AFTER_MS`, ou `remindedFor === lastInboundAt`. Senão `repeatQuestion(state, tools, text(msg.reminder))` com `remindedFor = lastInboundAt` no estado devolvido.
  - `msg.reminder: 'Ainda está aí? Seu pedido fica guardado por mais 5 minutos.'`
  - `ConversationService.advance`: estado não nulo → salva com `lastInboundAt = now` (ISO) e `scheduleReminder(phone, now + REMINDER_AFTER_MS)`; estado nulo → `clearOrder` + `cancelReminder`.
  - `ReminderScheduler` (`@Injectable`, `OnModuleInit`/`OnModuleDestroy`): `setInterval(tick, 30_000)` — **não** inicia quando `env.NODE_ENV === 'test'`. `tick(): Promise<void>` público (para teste): para cada `dueReminders(now)` → `claimReminder(phone, at)` (false → pula) → `tryPhoneLock` → `loadOrder` → `reminderFor` com tools de `forPhone(state => saveOrderKeepingTtl(phone, state))` → envia cada reply com `messaging.send` → `saveOrderKeepingTtl(phone, result.state)`. `tick` não roda em paralelo consigo mesmo (flag `running`). Erros por telefone são logados e não param a varredura.
  - Logs: info "Lembrete enviado" `{ from: maskPhone, step }`; debug "Lembrete ignorado" `{ from, reason: 'expired' | 'busy' | 'answered' | 'creatingSale' }`.

- [ ] **Step 1: Testes de `reminder.spec.ts`** (`FAKE_NOW` = 12:00)
  - `manda o lembrete e a pergunta da etapa com botões`: estado `choosePayment`, `lastInboundAt` 11:49 ⇒ `replies[0]` = `text(msg.reminder)`, `replies[1].type === 'buttons'`, `state.remindedFor` = `lastInboundAt`.
  - `nada antes dos 10 min` (`lastInboundAt` 11:51) ⇒ null.
  - `nada em creatingSale` ⇒ null.
  - `um lembrete por período parado`: `remindedFor === lastInboundAt` ⇒ null.
  - `lembra também em askCpfPrefix e saleFailed`.
- [ ] **Step 2: Testes de `reminder.scheduler.spec.ts`** (repositório, gateway e tools mockados)
  - `envia e salva mantendo o TTL`: `messaging.send` chamado 2×; `saveOrderKeepingTtl` chamado; `saveOrder` **não** chamado.
  - `claim falso não faz nada` (outra instância pegou).
  - `lock ocupado não envia` (`tryPhoneLock` → `{ ran: false }`).
  - `pedido expirado não envia` (`loadOrder` → null).
  - `erro num telefone não impede o próximo`.
  - `não inicia o intervalo em NODE_ENV=test`.
- [ ] **Step 3: Testes em `conversation.service.spec.ts`**
  - `agenda o lembrete 10 min depois da mensagem`: `scheduleReminder(phone, new Date(now + 600_000))`, estado salvo com `lastInboundAt`.
  - `pedido encerrado cancela o lembrete`: `clearOrder` e `cancelReminder` chamados.
- [ ] **Step 4:** `pnpm test src/modules/conversation` → FAIL.
- [ ] **Step 5:** Implementar e registrar `ReminderScheduler` em `ConversationModule.providers`.
- [ ] **Step 6:** → PASS. `pnpm lint`, `pnpm build`, `pnpm test:e2e` (precisa de `pnpm docker:init`; o agendador fica desligado em test).
- [ ] **Step 7:** `git commit -m "feat(conversation): lembrete de pedido parado aos 10 minutos (F12)"`

---

### Task 6: Documentação

**Files:**
- Modify: `docs/project/funcionalidades.md`, `docs/project/requisitos.md`, `docs/project/fluxo.md`, `docs/security/SECURITY.md`, `CLAUDE.md`

- [ ] **Step 1:** `funcionalidades.md`: F04, F12 e F14 entregues (2026-10-23); tirar F12 e F14 da tabela de melhorias futuras; nota de decisão de escopo de 2026-10-23.
- [ ] **Step 2:** `requisitos.md`: RF03 — cliente cadastrado sem CPF recebe o telefone da revenda (o bot não grava CPF em cadastro existente); seção "Decisões (2026-10-23)" com 3 dígitos, 15 dias por telefone+cliente, 3 tentativas, bloqueio 1 h, lembrete aos 10 min; remover o "risco conhecido" de 2026-10-21 (resolvido pela F14).
- [ ] **Step 3:** `fluxo.md`: etapas `askCpfPrefix` e `offerRepeat`, o lembrete e a saída de `askMissingCpf`.
- [ ] **Step 4:** `SECURITY.md`: verificação por prefixo de CPF, bloqueio contra chute, chave por telefone+cliente.
- [ ] **Step 5:** `CLAUDE.md`: na descrição do `ConversationService`/módulo, mencionar o `ReminderScheduler` (varredura a cada 30 s, lembrete aos 10 min, não renova o TTL) e a verificação de identidade.
- [ ] **Step 6:** `git commit -m "docs: F04, F12 e F14 entregues"`
