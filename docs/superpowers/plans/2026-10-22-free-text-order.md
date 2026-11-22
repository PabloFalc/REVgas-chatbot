# Pedido em texto livre (F03) e fallback de intenção — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando uma etapa não entende o texto do cliente, a IA lê a mensagem; o backend aplica ao pedido o que for válido (produto, quantidade, pagamento, endereço) e o fluxo pergunta só o que falta. Mensagem fora do pedido recebe resposta fixa e a pergunta da etapa é repetida.

**Architecture:** Novo módulo `src/modules/assistant/` com `AssistantService.interpret()` (LLM via `generateObject`, saída Zod). O fluxo ganha a ferramenta `FlowTools.interpret` e um arquivo `flow/free-text.ts` com: o filtro barato "parece pedido?", a aplicação pura do resultado ao `OrderState` e a orquestração (`freeText`, `seedFromText`, `keepOfferedProduct`). As etapas chamam `freeText` no ramo "não entendi". `nextStep` aprende a retomar rascunho de endereço, usar texto de endereço pendente e mostrar a lista de produtos ambíguos (nova etapa `pickProduct`).

**Tech Stack:** NestJS 11, TypeScript, Zod, Vitest, Biome. Usa `integrations/llm` (`LLM_CLIENT`, `FakeLlmClient`).

**Spec:** `docs/superpowers/specs/2026-10-22-free-text-order-design.md`

## Global Constraints

- Nomes de código em inglês; texto ao cliente em português, **sem emoji**, só em `src/modules/conversation/flow/messages.ts`.
- Sem comentários `//` explicativos no código (regra do `CLAUDE.md`).
- Arquivos de `flow/` (incluindo `free-text.ts`) não importam Nest, Redis, `integrations/`, serviços nem repositórios; só arquivos de `flow/`, `src/utils` e `src/modules/*/contracts/*`.
- A IA nunca define preço, total nem troco; produto/pagamento da IA só entram se existirem em `listProducts` / `listPaymentOptions`.
- O prompt recebe só o texto do cliente com CPFs removidos e a lista de nomes de produtos e formas de pagamento. Nunca dados do estado/cadastro (nome, telefone, endereço salvo, CPF).
- Limiar de confiança: **0,6** (constante `MIN_CONFIDENCE`).
- `creatingSale` e `saleFailed` nunca chamam a IA. `askNewAddress`, `askAddressField`, `searchProduct` continuam como hoje (sem `freeText`).
- Textos novos exatos: `offTopic` = `"Essa dúvida eu não consigo responder por aqui. " + storeContact(phone)`; `notUnderstood` = `"Não entendi."`; `chooseAmbiguousProduct` = `"Qual desses você quer?"`; `noted(parts)` = `` `Anotado: ${parts.join(', ')}.` ``.
- Commits em conventional commits, **sem** linhas `Co-Authored-By`/`Claude-Session`.
- Verificação de cada task: `pnpm test`, `pnpm lint`, `pnpm build`.

## Review Focus

1. **"2" digitado na etapa de quantidade com botões** (`chooseQuantity`): vira quantidade 2 sem chamar a IA (RNF09). Teste em Task 4.
2. **Cliente responde ao "Qual desses você quer?" com escolha inválida**: volta a lista **filtrada**, não a completa, e a quantidade dita antes continua. Teste em Task 3.
3. **CPF escrito no meio de uma frase** ("meu cpf é 123.456.789-00") em `askCpf`: sem palavra de pedido, cai no erro de CPF de hoje e **não** vai para a IA. Teste em Task 4.
4. **IA devolve produto com acento/caixa diferente** ("botijao p13"): casa com "Botijão P13" via `normalizeText`. Teste em Task 2.
5. **Primeira mensagem "oi"**: nenhuma chamada a `interpret`. Teste em Task 6.

---

## Mapa de arquivos

```
src/utils/cpf.ts (+spec)                                removeCpfs(text) (sai de address.service.ts)
src/modules/assistant/
  contracts/assistant.types.ts                          InterpretContext, Interpretation
  assistant.service.ts (+spec)                          AssistantService.interpret
  assistant.module.ts
src/modules/address/address.service.ts                  usa removeCpfs
src/modules/conversation/
  conversation.module.ts                                importa AssistantModule
  flow-tools.ts (+spec)                                 interpret → AssistantService
  flow/flow.types.ts                                    Step 'pickProduct'; OrderState.productCandidates, pendingAddressText; FlowTools.interpret
  flow/testing/fake-tools.ts                            interpret padrão → null
  flow/messages.ts                                      offTopic, notUnderstood, chooseAmbiguousProduct, noted
  flow/repeat-question.ts                               repeatQuestion (sai de global-commands.ts)
  flow/free-text.ts (+spec)                             looksLikeOrder, shouldInterpret, applyInterpretation, freeText, seedFromText, keepOfferedProduct
  flow/next-step.ts (+spec)                             rascunho, texto pendente, candidatos
  flow/steps/product.step.ts (+spec)                    pickProduct; "2" em chooseQuantity; fallbacks
  flow/steps/address.step.ts (+spec)                    askNewAddress usa pendingAddressText; fallbacks; reconfere produto após cadastro
  flow/steps/customer.step.ts (+spec)                   start(input, tools, seed); fallbacks; reconfere produto
  flow/steps/payment.step.ts, summary.step.ts (+spec)   fallbacks
  flow/flow.ts (+ flow.spec.ts)                         primeira mensagem passa por seedFromText
docs/project/*.md, CLAUDE.md                            Task 6
```

---

### Task 1: AssistantService e ferramenta `interpret`

**Files:**
- Modify: `src/utils/cpf.ts`, `src/utils/cpf.spec.ts` (ou criar o spec se não existir)
- Modify: `src/modules/address/address.service.ts` (troca `CPF_PATTERN` local por `removeCpfs`)
- Create: `src/modules/assistant/contracts/assistant.types.ts`, `assistant.service.ts`, `assistant.service.spec.ts`, `assistant.module.ts`
- Modify: `src/modules/conversation/flow/flow.types.ts`, `flow/testing/fake-tools.ts`, `flow-tools.ts`, `flow-tools.spec.ts`, `conversation.module.ts`

**Interfaces:**
- Produces:
  ```ts
  export function removeCpfs(text: string): string
  export interface InterpretContext { products: string[]; payments: { type: string; label: string }[] }
  export interface Interpretation {
    intent: 'order' | 'question' | 'other';
    products?: string[]; quantity?: number; payment?: string;
    address?: string; newAddress?: boolean; confidence: number;
  }
  class AssistantService { interpret(text: string, context: InterpretContext): Promise<Interpretation | null> }
  // FlowTools ganha:
  interpret(text: string, context: InterpretContext): Promise<Interpretation | null>;
  ```

- [ ] **Step 1: Testes que falham**

`cpf.spec.ts`: `removeCpfs('cpf 123.456.789-09 e 12345678909, casa 120')` → não contém `123.456.789-09` nem `12345678909` e contém `casa 120`.

`assistant.service.spec.ts` (com `new AssistantService(new FakeLlmClient())`):
- `devolve a interpretação sem campos nulos`: `queueObject({ intent:'order', products:['Botijão P13'], quantity:2, payment:'PIX', address:null, newAddress:null, confidence:0.9 })` → `{ intent:'order', products:['Botijão P13'], quantity:2, payment:'PIX', confidence:0.9 }`.
- `manda os produtos e pagamentos no prompt e tira o CPF`: a chamada registrada em `llm.calls[0]` tem `operation: 'interpret-order'`; o texto do sistema contém `Botijão P13` e `PIX`; a mensagem do usuário não contém `12345678909`.
- `devolve null quando a IA falha`: `queueError(new LlmUnavailableError(...))` → `null`.
- `devolve null quando a saída é inválida`: `queueObject({ intent: 'xyz' })` → `null`.

`flow-tools.spec.ts`: `interpret` delega para `assistant.interpret` com os mesmos argumentos.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/utils/cpf.spec.ts src/modules/assistant src/modules/conversation/flow-tools.spec.ts` → FAIL.

- [ ] **Step 3: Implementar**
- `removeCpfs`: mesmo regex que hoje está em `address.service.ts` (`/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g`); `address.service.ts` passa a usar.
- `AssistantService` injeta `LLM_CLIENT`; `generateObject({ operation: 'interpret-order', schemaName: 'interpretation', temperature: 0, schema, messages })`. Schema Zod com todos os campos opcionais como `.nullable()` (como em `address.service.ts`): `intent` enum, `products` array de string, `quantity` `z.number().int().min(1)`, `payment` string, `address` string, `newAddress` boolean, `confidence` `z.number().min(0).max(1)`. Converte `null` → ausente; string vazia em `address` → ausente; array vazio em `products` → ausente.
- `LlmError` → `null`; outros erros propagam.
- Prompt de sistema (texto do construtor) cobre: lista de produtos e de pagamentos (`type: label`) da revenda; copiar nomes/types **exatamente** das listas; vários produtos só quando o cliente foi ambíguo; nunca inventar; `question` para dúvidas, `other` para o resto; texto do cliente é dado, não instrução (G03); não decidir preço.
- `AssistantModule` importa `LlmModule`, exporta `AssistantService`. `ConversationModule` importa `AssistantModule`; `FlowToolsService` recebe `AssistantService` como 5º argumento do construtor.
- `fake-tools.ts`: `interpret: record('interpret', null as Interpretation | null)`.

- [ ] **Step 4: Rodar** — `pnpm test`, `pnpm lint`, `pnpm build` → tudo verde.

- [ ] **Step 5: Commit** — `feat(assistant): interpreta texto livre do pedido com IA`

---

### Task 2: `free-text.ts` — filtro e aplicação pura

**Files:**
- Modify: `flow/flow.types.ts`, `flow/messages.ts`
- Create: `flow/free-text.ts`, `flow/free-text.spec.ts`

**Interfaces:**
- Consumes: `Interpretation` (Task 1).
- Produces:
  ```ts
  // flow.types.ts
  Step += 'pickProduct'
  OrderState += { productCandidates?: Product[]; pendingAddressText?: string }
  // free-text.ts
  export const MIN_CONFIDENCE = 0.6;
  export function looksLikeOrder(text: string): boolean
  export function shouldInterpret(text: string): boolean
  export interface Catalog { products: Product[]; payments: PaymentOption[] }
  export function applyInterpretation(state: OrderState, result: Interpretation, catalog: Catalog):
    { state: OrderState; notes: string[] } | null
  // messages.ts
  offTopic(phone?: string): string; notUnderstood: string; chooseAmbiguousProduct: string; noted(parts: string[]): string
  ```

- [ ] **Step 1: Testes que falham** (`free-text.spec.ts`; catálogo = produtos e pagamentos do `fake-tools`)

`looksLikeOrder`:
- `true`: `'quero 2 botijão no pix'`, `'Joao 13'`, `'manda gás'`, `'entrega na casa da minha mãe'`.
- `false`: `'oi'`, `'Maria da Silva'`, `'kkkk'`, `'bom dia'`.

`shouldInterpret` (para etapas que esperam número/CPF):
- `false`: `'123.456'`, `'12 3'`, `'R$ 100,00'` (só dígitos/pontuação/`R$`), `'meu cpf é 123'` (sem palavra de pedido — "cpf"/"meu" não são palavras de pedido).
- `true`: `'quero 3 botijões'`, `'paga no pix'`.

`applyInterpretation`:
- `aplica produto, quantidade e pagamento`: `{intent:'order', products:['botijao p13'], quantity:3, payment:'PIX', confidence:0.9}` sobre estado com `quote` e `changeFor` → `product` P13, `quantity` 3, `payment` Pix, sem `quote`/`changeFor`; `notes` = `['3x Botijão P13', 'Pix']`.
- `troca só a quantidade e mantém o produto`: estado com P45, `{quantity:3}` → `quantity` 3, `product` P45, `notes` `['3x Botijão P45']`.
- `troca só o produto e limpa a quantidade`: estado com `quantity` 2, `{products:['Botijão P45']}` → sem `quantity`; `notes` `['Botijão P45']`.
- `produto ambíguo vira candidatos`: `{products:['Botijão P13','Botijão P45'], quantity:3}` → sem `product`, `productCandidates` com os dois, `quantity` 3, `notes` `[]`.
- `descarta produto e pagamento fora do catálogo`: `{products:['Lenha'], payment:'BITCOIN'}` → `null`.
- `endereço em texto`: estado com `address` e `draftAddress`, `{address:'rua X, 10'}` → sem `address`/`draftAddress`/`missingField`, `pendingAddressText` `'rua X, 10'`, `notes` `['entrega em outro endereço']`.
- `outro endereço sem texto`: `{newAddress:true}` → sem `address`/`pendingAddressText`, `notes` `['entrega em outro endereço']`.
- `sem nenhum campo válido devolve null`: `{intent:'question', confidence:0.9}` → `null`.

`messages`: `msg.noted(['3x Botijão P13','Pix'])` = `'Anotado: 3x Botijão P13, Pix.'`; `msg.offTopic('86999990000')` = `'Essa dúvida eu não consigo responder por aqui. Fale com a revenda: 86999990000.'`.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/modules/conversation/flow/free-text.spec.ts` → FAIL.

- [ ] **Step 3: Implementar**
- Palavras de pedido (após `normalizeText`, por palavra inteira): quero, queria, manda, mande, pedir, pedido, botijao, botijoes, gas, agua, pix, cartao, credito, debito, dinheiro, entrega, entregar, endereco, casa, rua. `looksLikeOrder` = tem dígito **ou** alguma dessas palavras.
- `shouldInterpret(text)` = não casa `/^[\d\s.,\-/R$]*$/i` **e** `looksLikeOrder(text)` sem contar dígitos (só palavras). (Por isso `'Joao 13'` é pedido em `askName`, mas `'12 3'` não vai à IA em `askQuantity`.)
- `applyInterpretation`: casa produtos por `normalizeText(nome) === normalizeText(item.name)`; regras de limpeza da spec §3 (trocar produto limpa `quantity` só se a mensagem não trouxe quantidade; quantidade limpa `quote`; pagamento limpa `quote` e `changeFor`; endereço limpa `address`, `draftAddress`, `missingField`). Um produto → limpa `productCandidates`. Notas: quantidade com produto resultante → `` `${q}x ${nome}` ``; só produto → nome; só quantidade sem produto (ambíguo) → nada; pagamento → `label`; endereço (texto ou `newAddress`) → `'entrega em outro endereço'`.

- [ ] **Step 4: Rodar** — `pnpm test`, `pnpm lint`, `pnpm build` → verde.

- [ ] **Step 5: Commit** — `feat(conversation): aplica ao pedido o que a IA entendeu do texto livre`

---

### Task 3: `nextStep` — rascunho, endereço pendente e produto ambíguo

**Files:**
- Modify: `flow/next-step.ts`, `flow/next-step.spec.ts`
- Modify: `flow/steps/address.step.ts`, `address.step.spec.ts`
- Modify: `flow/steps/product.step.ts`, `product.step.spec.ts`

**Interfaces:**
- Consumes: `OrderState.productCandidates`, `pendingAddressText`, `Step 'pickProduct'`, `msg.chooseAmbiguousProduct` (Task 2).
- Produces: `asks.pickProduct`, `handlers.pickProduct`. Ordem do `nextStep` quando falta endereço: `draftAddress` → (`askAddressField` se falta campo, senão `confirmAddress`); senão `pendingAddressText` → `askNewAddress`; senão o de hoje. Quando falta produto: `productCandidates?.length` → `pickProduct`; senão `chooseProduct`.

- [ ] **Step 1: Testes que falham**

`next-step.spec.ts`:
- `retoma o rascunho completo`: sem `address`, `draftAddress` completo → `step` `confirmAddress`.
- `retoma o rascunho com campo faltando`: `draftAddress` sem `number` → `askAddressField`, `missingField` `'number'`.
- `usa o texto de endereço pendente antes dos endereços salvos`: `addresses` com 2 itens e `pendingAddressText` → chama `addressFromText` com o texto e termina em `confirmAddress` (o fake devolve endereço completo); `pendingAddressText` some do estado.
- `mostra os candidatos quando o produto é ambíguo`: `productCandidates` [P13, P45] → `pickProduct`, lista com ids `['product:1','product:2']` e corpo `msg.chooseAmbiguousProduct`.

`address.step.spec.ts`:
- `askNewAddress com texto pendente que a IA não entende`: `addressFromText` → `null` → resposta `msg.didNotUnderstandAddress`, `step` `askNewAddress`, sem `pendingAddressText`.

`product.step.spec.ts` (`pickProduct`):
- `escolher um candidato mantém a quantidade`: estado `pickProduct` com candidatos e `quantity` 3, `pick('product:2')` → `product` P45, `quantity` 3, sem `productCandidates`.
- `escolha fora dos candidatos repete a lista filtrada`: `pick('product:3')` → mesma lista de 2 linhas.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/modules/conversation/flow` → FAIL nos novos.

- [ ] **Step 3: Implementar**
- `askNewAddress` (ask): se há `pendingAddressText`, remove-o do estado, chama `addressFromText` e segue `continueDraft`; `null` → `msg.didNotUnderstandAddress` em `askNewAddress`.
- `pickProduct` em `product.step.ts`: mostra `productCandidates` como lista (`msg.chooseAmbiguousProduct`, botão `msg.viewProducts`); handler aceita só ids dos candidatos, seta `product`, remove `productCandidates` e `quote`, **mantém** `quantity`, chama `nextStep`. Sem mexer em `selectProduct`.

- [ ] **Step 4: Rodar** — `pnpm test`, `pnpm lint`, `pnpm build` → verde.

- [ ] **Step 5: Commit** — `feat(conversation): retoma rascunho de endereço e pergunta produto ambíguo`

---

### Task 4: `freeText` e fallback nas etapas

**Files:**
- Create: `flow/repeat-question.ts` (move `repeatQuestion` de `global-commands.ts`, importando `asks` de `steps/registry`)
- Modify: `flow/global-commands.ts`, `flow/free-text.ts`, `free-text.spec.ts`
- Modify: `flow/steps/customer.step.ts`, `address.step.ts`, `product.step.ts`, `payment.step.ts`, `summary.step.ts` e specs

**Interfaces:**
- Consumes: `applyInterpretation`, `shouldInterpret`, `looksLikeOrder`, `MIN_CONFIDENCE` (Task 2); `nextStep` (Task 3); `tools.interpret` (Task 1).
- Produces:
  ```ts
  export function repeatQuestion(state: OrderState, tools: FlowTools, first: Reply): Promise<StepResult>
  export function freeText(state: OrderState, raw: string, tools: FlowTools): Promise<StepResult>
  ```

- [ ] **Step 1: Testes que falham**

`free-text.spec.ts` (`freeText`, com `createFakeTools({ interpret: async () => resultado })`):
- `IA indisponível repete a pergunta`: `interpret` → `null` em `choosePayment` → replies `[text(msg.notUnderstood), <botões de pagamento>]`, estado igual.
- `confiança baixa`: `confidence: 0.5` com campos → igual ao anterior.
- `dúvida sem campos`: `intent:'question'` → primeira reply `msg.offTopic('86999990000')`, depois a pergunta da etapa.
- `dúvida com campos aplica os campos`: `intent:'question', quantity:2` em `choosePayment` com produto → `quantity` 2, primeira reply `msg.noted(['2x Botijão P13'])`, segue `nextStep` (botões de pagamento).
- `troca quantidade e pede novo endereço`: em `choosePayment` com `address`, `{quantity:3, newAddress:true}` → primeira reply `'Anotado: 3x Botijão P13, entrega em outro endereço.'`, `step` `chooseAddress` (fake tem endereços salvos).
- `nas etapas de identificação repete a pergunta da etapa`: em `askName`, `{products:['Botijão P13'], payment:'PIX'}` → `product`/`payment` guardados, `step` continua `askName`, replies `[noted, text(msg.askName)]`.
- `manda o contexto do catálogo`: a chamada `interpret` recebe `{ products: ['Botijão P13','Botijão P45','Água mineral 20L'], payments: [...] }`; usa `productOptions`/`paymentOptions` do estado quando existem, senão chama `listProducts(priceCustomer)` / `listPaymentOptions()`.

Specs das etapas (uma linha cada; `interpret` fake devolve `{intent:'order', quantity:3, confidence:0.9}` salvo indicação):
- Etapas de botão (`chooseAddress`, `confirmAddress`, `chooseProduct`, `pickProduct`, `chooseQuantity`, `choosePayment`, `askNeedsChange`, `summary`, `chooseCorrection`): texto não reconhecido → `interpret` chamado e `quantity` 3 aplicada.
- `chooseQuantity` com texto `'2'` → `quantity` 2 e **nenhuma** chamada `interpret`.
- `askName` com `'Maria da Silva'` → segue para `askCpf`, sem `interpret`; com `'quero 2 botijão'` → `interpret` chamado.
- `askCpf` com `'123.456.789-09'` válido → segue, sem `interpret`; com `'123'` → `msg.invalidCpf`, sem `interpret`; com `'meu cpf é 123.456.789-00'` → `msg.invalidCpf`, sem `interpret`; com `'quero no pix'` → `interpret`.
- `askQuantity`/`askChangeAmount`: `'abc'` → erro de hoje sem `interpret`; `'quero no pix'` → `interpret`.
- `creatingSale`/`saleFailed`/`searchProduct`/`askNewAddress`/`askAddressField` com texto → **nenhuma** chamada `interpret`.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/modules/conversation/flow` → FAIL nos novos.

- [ ] **Step 3: Implementar**
- `freeText`: monta o catálogo (estado ou ferramentas), chama `tools.interpret(raw, context)`; `null` ou `confidence < MIN_CONFIDENCE` → `repeatQuestion(state, tools, text(msg.notUnderstood))`; `applyInterpretation` `null` → `offTopic` (se `question`) ou `notUnderstood` + `repeatQuestion`; senão: reply `noted(notes)` (omitida se `notes` vazio) + (`askName`/`askCpf`/`askMissingCpf` → `asks[state.step]` com o novo estado; demais → `nextStep`).
- Etapas: no ramo "não entendi", `textOf(input)` não nulo → `freeText` conforme a tabela da spec §1 (etapas de botão: sempre; `askName`: `looksLikeOrder`; CPF/quantidade/troco: depois da validação de hoje falhar, `shouldInterpret`). Escolha (`choice`) inválida continua repetindo a pergunta como hoje. `chooseQuantity` aceita texto `/^\d+$/` ≥ 1 como quantidade antes de tudo.

- [ ] **Step 4: Rodar** — `pnpm test`, `pnpm lint`, `pnpm build` → verde.

- [ ] **Step 5: Commit** — `feat(conversation): fallback de texto livre com IA em todas as etapas`

---

### Task 5: Primeira mensagem com pedido e reconferência do produto

**Files:**
- Modify: `flow/free-text.ts`, `free-text.spec.ts`
- Modify: `flow/flow.ts`, `flow/flow.spec.ts`
- Modify: `flow/steps/customer.step.ts` (+spec), `flow/steps/address.step.ts` (+spec)

**Interfaces:**
- Consumes: `applyInterpretation`, `looksLikeOrder` (Task 2).
- Produces:
  ```ts
  export interface Seed { fields: Partial<OrderState>; replies: Reply[] }
  export function seedFromText(raw: string, tools: FlowTools): Promise<Seed>
  export function keepOfferedProduct(state: OrderState, tools: FlowTools): Promise<OrderState>
  export function start(input: FlowInput, tools: FlowTools, seed?: Partial<OrderState>): Promise<StepResult>
  ```

- [ ] **Step 1: Testes que falham**

`flow.spec.ts` (fluxo inteiro com `runFlow`):
- `"oi" não chama a IA`: estado `null`, texto `'oi'` → nenhuma chamada `interpret`.
- `cliente novo com pedido completo`: telefone desconhecido, `interpret` → `{intent:'order', products:['Botijão P13'], quantity:2, payment:'PIX', confidence:0.9}`; replies começam com `'Anotado: 2x Botijão P13, Pix.'` e depois `msg.welcomeNew`; estado `askName` com produto/quantidade/pagamento. Seguindo com nome, CPF, CEP e `address:ok`, a próxima pergunta é o **resumo** (sem perguntar produto, quantidade nem pagamento).
- `cliente cadastrado com pedido completo`: `FAKE_PHONE`, mesma interpretação → depois de escolher o endereço (`address:0`) vai direto ao `summary`.
- `cliente novo com endereço na primeira mensagem`: `{address:'Rua A, 10, Centro'}` → após nome e CPF vai para `confirmAddress` (sem perguntar o endereço).
- `dúvida na primeira mensagem`: `intent:'question'`, sem campos → replies `[offTopic, welcomeNew]`.
- `IA falhou na primeira mensagem`: `null` → só o `start` de hoje (sem `notUnderstood`).

`keepOfferedProduct` (`free-text.spec.ts`):
- `descarta o produto que o cliente não pode comprar`: `listProducts` → só P45; estado com P13 e `quantity` 2 → sem `product` e sem `quantity`. Com candidatos [P13, P45] → `product` P45 (sobrou um).
- `mantém quando o produto está na lista`: estado igual.
- `sem produto nem candidatos não chama listProducts`.

`customer.step.spec.ts` / `address.step.spec.ts`: `start` de cliente cadastrado, `askMissingCpf` concluído e `confirmAddress` de cliente novo chamam `listProducts` com o cliente identificado quando há `product` no estado.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/modules/conversation/flow` → FAIL nos novos.

- [ ] **Step 3: Implementar**
- `seedFromText`: catálogo anônimo (`listProducts({})`, `listPaymentOptions()`), `interpret`; `null`/baixa confiança → `{ fields: {}, replies: [] }`; sem campos e `question` → `replies: [text(msg.offTopic(storePhone))]`; com campos → `fields` = `product`, `quantity`, `payment`, `productCandidates`, `pendingAddressText` resultantes de `applyInterpretation` sobre `{ step: 'askName', customer: {} }`, `replies: [text(msg.noted(notes))]` (omitida se vazio).
- `runFlow`: sem estado e entrada de texto com `looksLikeOrder` → `seedFromText`, depois `start(input, safe, seed.fields)`; replies = `[...seed.replies, ...start.replies]`.
- `start` mescla `seed` no estado inicial (cliente novo e cadastrado); cliente cadastrado com CPF passa por `keepOfferedProduct` antes do `nextStep`. `handleAskMissingCpf` e `handleConfirmAddress` (depois de `createCustomer`) também chamam `keepOfferedProduct` antes do `nextStep`.
- `keepOfferedProduct`: sem `product` e sem `productCandidates` → devolve o estado sem chamar nada; senão filtra pelos ids de `listProducts(priceCustomer)`; produto removido também remove `quantity` e `quote`; candidatos que sobrarem 1 viram `product`.

- [ ] **Step 4: Rodar** — `pnpm test`, `pnpm lint`, `pnpm build` → verde.

- [ ] **Step 5: Commit** — `feat(conversation): aproveita o pedido da primeira mensagem`

---

### Task 6: Documentação

**Files:** `docs/project/funcionalidades.md`, `docs/project/requisitos.md`, `docs/project/fluxo.md`, `docs/project/specs.md`, `CLAUDE.md`, `docs/guides/integrations/llm.md` (seção de consumidores, se existir)

- [ ] **Step 1: Atualizar**
- `funcionalidades.md`: tabela do MVP fica F01–F05 (F03 marcado entregue; F04 e F05 "pendente"). Nova seção **"Melhorias futuras (fora do escopo atual)"** com F06, F07, F08, F09, F10, F11, F12, F13 e RN13 (salvar venda/conversas no Postgres), junto com F14 que já estava no roadmap. Nota de decisão 2026-10-22.
- `requisitos.md`: RF10 e RN13 marcados como melhoria futura; decisão de 2026-10-22 (texto livre e fallback com resposta fixa; FAQ fica para depois).
- `fluxo.md`: seção "Texto livre e fallback" com a tabela de quando a IA é chamada (spec §1), a etapa `pickProduct` na tabela de steps, a regra nova do `nextStep` (rascunho → texto pendente → endereços salvos; candidatos → `pickProduct`); trocar "Dúvida no meio do fluxo (FAQ): responde" por "resposta fixa e repete a pergunta".
- `specs.md`: substituir o `interpretar()` proposto pelo contrato real (`Interpretation`, `InterpretContext`); `responderFaq()` como futuro.
- `CLAUDE.md`: `modules/assistant/` na árvore e `interpret` citado em `FlowTools`/`flow-tools.ts`.

- [ ] **Step 2: Verificar** — `pnpm lint` → verde; links relativos entre os docs abrem.

- [ ] **Step 3: Commit** — `docs: texto livre no fluxo e melhorias futuras do escopo`
