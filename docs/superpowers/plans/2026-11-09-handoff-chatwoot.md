# Handoff para atendente via Chatwoot (F07) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O cliente pede atendente (ou a venda falha) e entra na fila do Chatwoot com um resumo; o bot
segue atendendo até o primeiro humano falar, depois só repassa; todas as conversas ficam espelhadas
no Chatwoot.

**Architecture:** Integração nova `integrations/chatwoot/` (cliente HTTP + fake + webhook assinado).
Módulo novo `modules/handoff/` (estado no Redis, gateway do Chatwoot, `HandoffService`). O fluxo
ganha duas ferramentas (`requestHandoff`, `serviceHours`) e um helper puro `flow/handoff.ts`. O
`ConversationService` consulta o estado antes do fluxo e espelha o turno depois de responder. O
webhook do Chatwoot (`POST /webhooks/chatwoot`) fica no `ConversationModule` (precisa do lock por
telefone, do pedido e do WhatsApp), então o `RoutesModule` continua importando só ele.

**Tech Stack:** NestJS 11 (Fastify), ioredis, Zod 4, Vitest, Biome, Docker Compose. pnpm.

**Spec:** `docs/superpowers/specs/2026-11-09-handoff-chatwoot-design.md`

## Global Constraints

- Sem comentários `//` explicativos no código. Textos ao cliente em `flow/messages.ts`, português, sem emoji.
- `flow/` e `flow/steps/` não importam Nest, Redis, integrações, serviços nem repositórios (só arquivos
  do fluxo, `src/utils` e `contracts/` dos módulos). Testar com `createFakeTools`.
- Serviços de `modules/` não importam `integrations/` (só gateway/repositório). Controllers podem
  (precedente: `ConversationController` injeta `WHATSAPP_WEBHOOK`).
- **Dígitos de CPF nunca chegam ao Chatwoot.** Etapas `askCpf`/`askCpfPrefix` → `[CPF ocultado]`;
  em qualquer etapa, trechos que casam com o padrão de CPF de `src/utils/cpf` → `[CPF ocultado]`. A nota
  de resumo não tem campo de CPF.
- Segredos novos: `CHATWOOT_API_TOKEN`, `CHATWOOT_BOT_TOKEN`, `CHATWOOT_WEBHOOK_SECRET` — nunca em
  log, resposta ou prompt. Logs: telefone com `maskPhone`, nunca o texto das mensagens.
- Falha do Chatwoot **nunca** derruba nem atrasa a resposta ao cliente: o espelho roda depois do envio
  ao WhatsApp e engole erros (log `warn`).
- **Nunca reenviar POST** ao Chatwoot automaticamente (sem retry em nenhuma chamada).
- Webhook do Chatwoot sem segredo configurado → recusa tudo (401). Nunca aceita sem assinatura.
- `pnpm test`, `pnpm test:e2e` e a CI não dependem de Chatwoot rodando (`CHATWOOT_MODE=fake` nos testes).
- Commits: conventional commits em português, **sem** `Co-Authored-By`/`Claude-Session`. Sem push.
- Docker/e2e são compartilhados com outro agente: **antes de `pnpm test:e2e` ou de subir/recriar
  contêineres, pedir a vez com `maestri ask "maestro" "<o que vai rodar>"` e esperar a resposta.**
  `pnpm test`, `pnpm lint`, `pnpm build` e `docker compose config` podem rodar à vontade.
- Trabalhar só em `C:\Users\pablo\Documents\Code\REVgas-chatbot-handoff`. Nunca ler o `.env`.
- Ao fim de cada task: `pnpm lint` e `pnpm test` verdes.

## Valores fixados

- Chatwoot **`chatwoot/chatwoot:v4.19.1-ce`** (estável mais recente em 2026-10-24; `-ce` porque o
  comportamento foi conferido no código CE). Postgres `pgvector/pgvector:pg16`, Redis `redis:7-alpine`
  sem política de despejo. Porta `127.0.0.1:3000`.
- Assinatura do webhook (v4.19.1, `lib/webhooks/trigger.rb`): headers `X-Chatwoot-Signature:
  sha256=<hex>` e `X-Chatwoot-Timestamp: <unix s>`; HMAC-SHA256 com o segredo sobre
  `` `${timestamp}.${rawBody}` ``. O Chatwoot não confere idade: nós recusamos timestamp com mais de
  **300 s** de diferença.
- Prazos: `active` expira **24 h** após a última mensagem do atendente; `queued` expira **72 h**
  após entrar na fila. Chaves do Redis com TTL de **7 dias** (estado e conversa atual) e **30 dias**
  (contato). Dedup de mensagem do atendente: **24 h**. `CHATWOOT_TIMEOUT_MS` padrão **5000**.
- Fuso fixo `America/Fortaleza`.

## Decisões do builder (onde o design diz "Fica com o builder")

1. **Dois tokens.** `CHATWOOT_API_TOKEN` (usuário admin) só para contatos (bot token não tem acesso a
   contatos no v4.19.1). `CHATWOOT_BOT_TOKEN` (Agent Bot **não conectado** à caixa) para todo o resto:
   criar conversa, mensagens de entrada/saída, notas e status. Motivo: `toggle_status` com token de
   usuário atribui a conversa a esse usuário; com token de bot, `open` faz handoff sem atribuição. Bot
   não conectado = a caixa não força `pending` nem manda eventos para outro URL; criamos a conversa já
   com `status: 'pending'`.
2. **Eco:** só é "mensagem humana" o evento `message_created` com `message_type === 'outgoing'`,
   `private === false` e `sender.type === 'user'`. Mensagens do bot têm `sender.type === 'agent_bot'`,
   as que copiamos do cliente são `incoming`, notas são `private`. Mais dedup por id da mensagem.
3. **Webhook:** o `webhook_url` da própria caixa API (só eventos dessa caixa, assinado com o segredo
   do canal). O guia avisa para **não** cadastrar também um webhook da conta (chegaria em dobro).
4. **Telefone do evento:** `conversation.meta.sender.identifier` (criamos o contato com
   `identifier = wa_id`), com fallback para `conversation.contact_inbox.source_id`; precisa casar
   `/^\d{8,15}$/`, e o `inbox_id` do evento precisa ser o `CHATWOOT_INBOX_ID`.
5. **Espelho síncrono depois do envio**, dentro do lock do telefone, com timeout curto e erros
   engolidos. A resposta ao cliente já saiu; serializar evita conversas duplicadas.
6. **Expiração preguiçosa:** conferida quando o telefone manda mensagem ou quando o handoff é
   consultado (sem varredura nova). Ao expirar: nota "Handoff expirado, o bot voltou a atender.",
   resolve a conversa (melhor esforço) e apaga o estado. Prazo do `queued`: 72 h.
7. **Ciclo de conversa:** uma conversa do Chatwoot por ciclo. Ciclo novo = chega mensagem sem pedido
   no Redis e sem handoff; se havia conversa guardada (pedido expirou), ela é resolvida e uma nova é
   criada como `pending`. Fim do ciclo (fluxo devolve `state: null`, sem handoff) → resolve e esquece.
   Nunca postamos em conversa resolvida (no v4.19.1 isso a reabriria como `open`).
8. **`SERVICE_HOURS`:** `seg-sex 08:00-18:00; sab 08:00-12:00`. Entradas separadas por `;`; dias
   `dom seg ter qua qui sex sab` (sem diferenciar maiúsculas/acentos), intervalo `seg-sex` ou lista
   `seg,qua,sex`; horário `HH:MM-HH:MM` com fim > início (`24:00` vale como fim). Vazio = sempre aberto.
   Valor inválido derruba o boot.
9. **Modos `CHATWOOT_MODE`:** `live` | `fake` | `off`. Vazio: `live` se houver `CHATWOOT_API_TOKEN`,
   senão `off`. `off` = comportamento de hoje (telefone da revenda), sem espelho, webhook 401.
10. **Botão "Falar com atendente"** tem id fixo `handoff:request`, tratado como **comando global** (vale
    em qualquer etapa). Em `saleFailed` o motivo é `sale_failed`; nas demais, `customer_request`.
11. **Mensagem não suportada em `active`:** `[cliente enviou <tipo>]` com `audio→áudio`,
    `image→imagem`, `video→vídeo`, `document→documento`, `sticker→figurinha`,
    `location→localização`; outros → `[cliente enviou mensagem não suportada]`.
12. **Pedido de atendente responde só o texto do handoff** (não repete a pergunta da etapa), como hoje.

## Contratos para o outro agente (RAG/guard rails) — manter estáveis

- `FlowTools.requestHandoff(request: HandoffRequest): Promise<HandoffOutcome>`
- `FlowTools.serviceHours(): Promise<ServiceHoursInfo>`
- `flow/handoff.ts`: `handoff(state, phone, reason, tools): Promise<StepResult>` (resposta pronta),
  `HANDOFF_CHOICE = 'handoff:request'`, `handoffButton(): ReplyOption`.
- `HandoffReason` é união de literais em `modules/handoff/contracts/handoff.types.ts`; motivo novo =
  adicionar o literal e o rótulo em `REASON_LABELS` (`src/modules/handoff/contracts/handoff-note.ts`), que o compilador cobra.
- `src/utils/service-hours.ts`: `parseServiceHours`, `isOpenAt`, `nextOpening`, `SERVICE_TIME_ZONE`.

## Review Focus

1. **Atendente responde enquanto o bot está em `creatingSale`** → o evento espera o lock do telefone;
   depois apaga o pedido e repassa a mensagem; o cliente não recebe "Confirmar"/"Tentar de novo" depois
   (teste na Task 7: lock chamado antes de `clearOrder`).
2. **Cliente digita o CPF no meio do texto em outra etapa** (ex.: "meu cpf é 123.456.789-09") → o
   Chatwoot recebe `meu cpf é [CPF ocultado]` (teste na Task 5).
3. **Webhook reenviado ou repetido** (mesmo id de mensagem) → o cliente recebe a mensagem do atendente
   uma vez só (teste na Task 7).
4. **Chatwoot fora do ar no meio do turno** → cliente recebe a resposta do bot normalmente; pedido de
   atendente cai em `msg.talkToStore` (testes nas Tasks 5 e 6).
5. **Resolução atrasada de uma conversa antiga** chega depois de o bot abrir a nova → não apaga o
   handoff/conversa atuais (só age se o id bater; teste na Task 5).

---

## Mapa de arquivos

| Arquivo | Papel |
| --- | --- |
| `src/utils/service-hours.ts` (+spec) — novo | Parser e cálculo do horário de atendimento |
| `src/utils/cpf.ts` (+spec) | `hideCpfs(text)` |
| `src/config/env.ts` (+spec), `.env.example` | `CHATWOOT_*`, `SERVICE_HOURS` |
| `src/core/erros/chatwoot/chatwoot.errors.ts` (+spec) — novo | `ChatwootError` e `mapChatwootError` |
| `src/integrations/chatwoot/` — novo | config, cliente, http, fake, factory, module, webhook, testing |
| `src/modules/handoff/` — novo | contracts, `handoff-note.ts`, `handoff.repository.ts`, `desk.gateway.ts`, `handoff.service.ts`, `handoff.module.ts` |
| `src/modules/conversation/flow/flow.types.ts`, `testing/fake-tools.ts`, `flow-tools.ts` | Ferramentas novas |
| `src/modules/conversation/flow/handoff.ts` (+spec) — novo | Helper do handoff no fluxo |
| `flow/global-commands.ts`, `flow/steps/summary.step.ts`, `flow/messages.ts` (+specs) | Gatilhos e textos |
| `src/modules/conversation/conversation.service.ts` (+spec), `reply-text.ts` (+spec) — novo | Roteamento e espelho |
| `src/modules/conversation/desk-events.service.ts`, `desk-webhook.controller.ts`, `docs/desk-webhook.doc.ts` — novos | Webhook do Chatwoot |
| `tests/conversation/chatwoot-webhook.e2e.spec.ts` — novo, `vitest.config.e2e.ts` | E2e |
| `docker-compose.yml`, `docker/chatwoot.env.example`, `.gitignore`, `package.json` | Chatwoot no Docker |
| `docs/guides/integrations/chatwoot.md` — novo e demais docs | Task 9 |

---

### Task 1: Horário de atendimento, `hideCpfs` e variáveis de ambiente

**Files:**
- Create: `src/utils/service-hours.ts`, `src/utils/service-hours.spec.ts`
- Modify: `src/utils/cpf.ts`, `src/utils/cpf.spec.ts`, `src/config/env.ts`, `src/config/env.spec.ts`, `.env.example`

**Interfaces — Produces:**
```ts
export const SERVICE_TIME_ZONE = 'America/Fortaleza';
export interface ServiceWindow { day: number; start: number; end: number }
export interface Opening { weekday: number; time: string; inDays: number }
export function parseServiceHours(text: string): ServiceWindow[];
export function isOpenAt(windows: ServiceWindow[], date: Date, timeZone?: string): boolean;
export function nextOpening(windows: ServiceWindow[], date: Date, timeZone?: string): Opening | null;
export function hideCpfs(text: string): string;
```
`day` 0 = domingo; `start`/`end` em minutos do dia; `time` `HH:MM`; `inDays` 0 = hoje, 1 = amanhã…
`parseServiceHours('')` → `[]`; inválido → `throw new Error(<motivo em português>)`.
`isOpenAt([])` → true; `nextOpening([])` → null; `nextOpening` = menor início estritamente depois de
`date` nos próximos 7 dias. Hora local via `Intl.DateTimeFormat` com `timeZone` (sem biblioteca).

Env (todas com `emptyAsUndefined`): `CHATWOOT_MODE` enum `live|fake|off` opcional; `CHATWOOT_URL` url
default `http://localhost:3000`; `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_INBOX_ID` int positivo opcional;
`CHATWOOT_API_TOKEN`, `CHATWOOT_BOT_TOKEN` string opcional; `CHATWOOT_WEBHOOK_SECRET` string min 16
opcional; `CHATWOOT_TIMEOUT_MS` int positivo default 5000; `SERVICE_HOURS` string opcional com
`superRefine` que chama `parseServiceHours` e reporta a mensagem do erro.

- [ ] **Step 1: Testes** (`service-hours.spec.ts`, datas em `-03:00`):
  - `parseServiceHours('seg-sex 08:00-18:00; sab 08:00-12:00')` → 6 janelas, ex. `{ day: 1, start: 480, end: 1080 }` e `{ day: 6, start: 480, end: 720 }`.
  - aceita `'SÁB 08:00-12:00'` e `'seg,qua 09:00-10:30'` (dias 1 e 3) e `'dom 20:00-24:00'` (end 1440).
  - lança para `'seg 18:00-08:00'`, `'xyz 08:00-12:00'`, `'seg 8-12'`, `'seg'`.
  - `isOpenAt(w, new Date('2026-11-09T10:00:00-03:00'))` (segunda) → true; `'2026-11-09T18:00:00-03:00'` → false (fim exclusivo); `'2026-11-08T10:00:00-03:00'` (domingo) → false; `isOpenAt([], qualquer)` → true.
  - `nextOpening(w, new Date('2026-11-08T10:00:00-03:00'))` → `{ weekday: 1, time: '08:00', inDays: 1 }`; sábado `'2026-11-14T13:00:00-03:00'` → `{ weekday: 1, time: '08:00', inDays: 2 }`; segunda `'2026-11-09T06:00:00-03:00'` → `{ weekday: 1, time: '08:00', inDays: 0 }`; mesmo instante em UTC (`'2026-11-09T09:00:00Z'`) dá o mesmo resultado.
  - `cpf.spec.ts`: `hideCpfs('meu cpf é 123.456.789-09 ok')` → `'meu cpf é [CPF ocultado] ok'`; `hideCpfs('12345678909')` → `'[CPF ocultado]'`; `hideCpfs('rua 123 nº 45')` inalterado.
  - `env.spec.ts`: `SERVICE_HOURS: 'seg 18:00-08:00'` → `safeParse` falha com path `SERVICE_HOURS`; `'seg-sex 08:00-18:00'` passa; `CHATWOOT_MODE: ''` → undefined; `CHATWOOT_TIMEOUT_MS` default 5000.
- [ ] **Step 2:** `pnpm test src/utils src/config` → FAIL.
- [ ] **Step 3:** Implementar. `env.ts` importa de `../utils/service-hours`. `.env.example`: bloco `# CHATWOOT` com as variáveis vazias e comentários curtos (modo, onde achar cada valor: ver `docs/guides/integrations/chatwoot.md`) e `SERVICE_HOURS=` com exemplo comentado.
- [ ] **Step 4:** `pnpm test` e `pnpm lint` → PASS.
- [ ] **Step 5:** `git commit -m "feat(config): horário de atendimento e variáveis do Chatwoot"`

---

### Task 2: Cliente do Chatwoot (`integrations/chatwoot/`)

**Files:**
- Create: `src/core/erros/chatwoot/chatwoot.errors.ts` (+spec), `src/integrations/chatwoot/shared/chatwoot.config.ts` (+spec), `chatwoot.client.ts`, `chatwoot.schemas.ts`, `http-chatwoot.client.ts` (+spec), `fake-chatwoot.client.ts` (+spec), `chatwoot.factory.ts` (+spec), `chatwoot.module.ts`

**Interfaces — Produces:**
```ts
export type ChatwootErrorKind = 'unauthorized' | 'not_found' | 'rejected' | 'unavailable' | 'response' | 'unknown_outcome';
export class ChatwootError extends Error { readonly kind; readonly status?: number }
export function mapChatwootError(status: number): ChatwootError;

export type ChatwootMode = 'live' | 'fake' | 'off';
export interface ChatwootConfig { mode: ChatwootMode; baseUrl: string; accountId?: number; inboxId?: number;
  apiToken?: string; botToken?: string; webhookSecret?: string; timeoutMs: number }
export function resolveChatwootConfig(env: Env): ChatwootConfig;
export const CHATWOOT_CONFIG = Symbol('CHATWOOT_CONFIG');

export const CHATWOOT_CLIENT = Symbol('CHATWOOT_CLIENT');
export type ConversationStatus = 'open' | 'pending' | 'resolved';
export interface ChatwootContact { id: number; identifier: string | null; sourceIds: Record<number, string> }
export interface ChatwootClient {
  findContact(identifier: string): Promise<ChatwootContact | null>;
  createContact(input: { name: string; identifier: string; phoneNumber: string; sourceId: string }): Promise<{ contactId: number; sourceId: string }>;
  createContactInbox(contactId: number, sourceId: string): Promise<{ sourceId: string }>;
  createConversation(input: { contactId: number; sourceId: string; status: ConversationStatus }): Promise<{ id: number }>;
  createMessage(conversationId: number, input: { content: string; type: 'incoming' | 'outgoing'; private?: boolean }): Promise<{ id: number }>;
  setStatus(conversationId: number, status: ConversationStatus): Promise<void>;
}
```
`sourceIds` é `inboxId → source_id` dos `contact_inboxes`. Factory: `createChatwootClient(config, deps?)`
devolve `ChatwootClient | null` (`off` → null). `ChatwootModule` provê `CHATWOOT_CLIENT`,
`CHATWOOT_CONFIG` e `CHATWOOT_WEBHOOK` (Task 3) e exporta os três.

Config: modo vazio → `live` se `CHATWOOT_API_TOKEN`, senão `off`. `live` exige `CHATWOOT_ACCOUNT_ID`,
`CHATWOOT_INBOX_ID`, `CHATWOOT_API_TOKEN`, `CHATWOOT_BOT_TOKEN`, `CHATWOOT_WEBHOOK_SECRET` (lança
`Error` listando os que faltam, como `resolveWhatsappConfig`). `fake` com `inboxId` ausente usa `1`.
Barra final da URL removida.

HTTP (v4.19.1, base `${baseUrl}/api/v1/accounts/${accountId}`, header `api_access_token`, JSON,
`AbortSignal.timeout`, **sem retry**):
- `findContact` → `GET /contacts/search?q=<identifier url-encoded>` com **apiToken**; resposta
  `{ payload: Contact[] }`; devolve o primeiro com `identifier === identifier` exato, senão null.
- `createContact` → `POST /contacts` com **apiToken**, corpo `{ inbox_id, name, identifier, phone_number, source_id }`; resposta `{ payload: { contact: { id }, contact_inbox: { source_id } } }`.
- `createContactInbox` → `POST /contacts/{id}/contact_inboxes` **apiToken** `{ inbox_id, source_id }` → `{ source_id }`.
- `createConversation` → `POST /conversations` **botToken** `{ source_id, inbox_id, contact_id, status }` → `{ id }`.
- `createMessage` → `POST /conversations/{id}/messages` **botToken** `{ content, message_type, private }` → `{ id }`.
- `setStatus` → `POST /conversations/{id}/toggle_status` **botToken** `{ status }`.
- Zod `z.looseObject` nas respostas; fora do formato → `ChatwootError('response')`.
- Erros: 401/403 → `unauthorized`; 404 → `not_found`; outros 4xx → `rejected`; 5xx → `unavailable`
  (em POST também `unavailable`, sem repetir); rede/timeout em GET → `unavailable`, em POST →
  `unknown_outcome`. Log (`{ component: 'chatwoot', op, status, durationMs }`) sem token, sem corpo,
  sem telefone.

Fake (`FakeChatwootClient`): guarda `contacts`, `conversations: Map<number, { id; contactId; status; messages: { id; content; type; private }[] }>`, ids sequenciais; `failNext()` faz a próxima chamada lançar `ChatwootError('unavailable')`; `clear()`.

- [ ] **Step 1: Testes**
  - `http-chatwoot.client.spec.ts` (fetch mock como em `http-viacep.client.spec.ts`): URL e header de cada operação (contatos com `api-token`, demais com `bot-token`); `findContact` ignora resultado com identifier diferente (`'5586999991234'` vs `'55869999912345'`); 500 em POST → `unavailable` e `fetch` chamado 1 vez; rede em POST → `unknown_outcome`; 401 → `unauthorized`; resposta sem `id` → `response`.
  - `fake-chatwoot.client.spec.ts`: cria contato, conversa `pending`, mensagens e status; `failNext` só afeta a próxima.
  - `chatwoot.config.spec.ts`: sem modo e sem token → `off`; com token → `live`; `live` sem `CHATWOOT_BOT_TOKEN` lança com o nome da variável.
  - `chatwoot.factory.spec.ts`: `off` → null; `fake` → `FakeChatwootClient`; `live` → `HttpChatwootClient`.
  - `chatwoot.errors.spec.ts`: `mapChatwootError` para 401, 403, 404, 422, 503.
- [ ] **Step 2:** `pnpm test src/integrations/chatwoot src/core/erros/chatwoot` → FAIL.
- [ ] **Step 3:** Implementar (seguir `integrations/viacep` e `cloud-api-whatsapp.client.ts`).
- [ ] **Step 4:** `pnpm test` e `pnpm lint` → PASS.
- [ ] **Step 5:** `git commit -m "feat(chatwoot): cliente da API do Chatwoot com modo fake"`

---

### Task 3: Webhook do Chatwoot (assinatura e leitura dos eventos)

**Files:**
- Create: `src/integrations/chatwoot/webhook/signature.ts` (+spec), `webhook.schemas.ts`, `chatwoot-webhook.ts` (+spec), `src/integrations/chatwoot/testing/webhook.testing.ts`
- Modify: `src/integrations/chatwoot/chatwoot.module.ts`

**Interfaces — Produces:**
```ts
export function signChatwootPayload(rawBody: Buffer | string, timestamp: string, secret: string): string; // 'sha256=<hex>'
export const CHATWOOT_WEBHOOK = Symbol('CHATWOOT_WEBHOOK');
export type ChatwootEvent =
  | { kind: 'agentMessage'; messageId: number; conversationId: number; inboxId: number; phone: string | null; agentName: string; content: string }
  | { kind: 'conversationResolved'; conversationId: number; inboxId: number; phone: string | null };
export class ChatwootWebhook {
  constructor(config: Pick<ChatwootConfig, 'webhookSecret' | 'inboxId'>);
  isAuthentic(rawBody: Buffer | string | undefined, signature: string | undefined, timestamp: string | undefined, nowMs: number): boolean;
  parse(payload: unknown): ChatwootEvent[] | null; // null = payload inválido
}
// testing
export function agentMessageWebhook(opts: { phone: string; content: string; messageId?: number; conversationId?: number; senderType?: 'user' | 'agent_bot'; messageType?: 'incoming' | 'outgoing'; private?: boolean; inboxId?: number; agentName?: string }): object;
export function resolvedWebhook(opts: { phone: string; conversationId?: number; inboxId?: number }): object;
export function signedHeaders(raw: string, secret: string, nowMs?: number): Record<string, string>;
```
`isAuthentic`: sem segredo → false; timestamp não numérico ou `|nowMs - ts*1000| > 300_000` → false;
compara com `safeEqual`. `parse`: precisa ser objeto com `event` string (senão null). `message_created`
→ `agentMessage` só se `message_type === 'outgoing'`, `private === false`, `sender.type === 'user'`,
`content` não vazio. `conversation_status_changed` com `status === 'resolved'` → `conversationResolved`.
Outros eventos → `[]`. Evento de `inbox_id` diferente do configurado → `[]`. `phone` =
`conversation.meta.sender.identifier` ou `conversation.contact_inbox.source_id`, aceito só se casar
`/^\d{8,15}$/`, senão null. `agentName` = `sender.name` ou `'Atendente'`. Payload real:
`message.webhook_data` (campos `id, content, message_type, private, sender, conversation{ id, inbox_id, meta.sender, contact_inbox }, inbox{ id }, event`).

- [ ] **Step 1: Testes**
  - assinatura válida passa; corpo alterado, segredo errado, header sem `sha256=`, timestamp de 301 s atrás, sem segredo configurado → false.
  - `parse`: mensagem humana vira `agentMessage` com `phone`, `agentName`, `content`; `agent_bot`, `incoming`, `private: true`, conteúdo vazio, outra caixa → `[]`; status `resolved` → `conversationResolved`, `open` → `[]`; `'x'`/`{}` → null; identifier `'abc'` sem source_id → `phone: null`.
- [ ] **Step 2:** `pnpm test src/integrations/chatwoot/webhook` → FAIL.
- [ ] **Step 3:** Implementar; registrar `CHATWOOT_WEBHOOK` no `ChatwootModule`.
- [ ] **Step 4:** `pnpm test` e `pnpm lint` → PASS.
- [ ] **Step 5:** `git commit -m "feat(chatwoot): webhook assinado e leitura dos eventos do atendente"`

---

### Task 4: Módulo `handoff` — contratos, nota, repositório e gateway

**Files:**
- Create: `src/modules/handoff/contracts/handoff.types.ts`, `handoff-note.ts` (+spec), `handoff.repository.ts` (+spec), `desk.gateway.ts` (+spec)

**Interfaces — Produces:**
```ts
// contracts/handoff.types.ts
export type HandoffReason = 'customer_request' | 'sale_failed';
export interface HandoffOrderSummary { stepLabel: string; identityConfirmed: boolean; newCustomer: boolean;
  customerName?: string; product?: string; quantity?: number; address?: string; payment?: string; total?: number }
export interface HandoffRequest { phone: string; reason: HandoffReason; summary: HandoffOrderSummary | null }
export type HandoffStatus = 'queued' | 'alreadyQueued' | 'active' | 'unavailable';
export interface HandoffOutcome { status: HandoffStatus; open: boolean; nextOpening: Opening | null }
export interface ServiceHoursInfo { open: boolean; nextOpening: Opening | null; windows: ServiceWindow[] }
export type DeskInbound =
  | { type: 'text'; text: string } | { type: 'choice'; title: string } | { type: 'unsupported'; originalType?: string };
export type DeskEvent =
  | { kind: 'agentMessage'; messageId: number; conversationId: number; inboxId: number; phone: string | null; agentName: string; content: string }
  | { kind: 'conversationResolved'; conversationId: number; inboxId: number; phone: string | null };
// mesmo formato de ChatwootEvent (Task 3): o controller passa um para o outro e o módulo não importa a integração
export interface HandoffState { status: 'queued' | 'active'; conversationId: number; reason: HandoffReason | 'agent'; since: string; lastAgentAt?: string }
export interface DeskThread { conversationId: number }
export interface DeskContact { contactId: number; sourceId: string }

// handoff-note.ts
export const REASON_LABELS: Record<HandoffReason, string>; // 'Cliente pediu atendente', 'Falha ao registrar a venda na RevGás'
export function handoffNote(reason: HandoffReason, summary: HandoffOrderSummary | null): string;
export function saleNote(saleId: number): string;          // 'Venda #123 criada pelo bot, saiu da fila.'
export const EXPIRED_NOTE: string;                         // 'Handoff expirado, o bot voltou a atender.'
export const WINDOW_CLOSED_NOTE: string;                   // 'O cliente está fora da janela de 24 h do WhatsApp: ele precisa mandar uma mensagem antes de você responder.'

// handoff.repository.ts (RedisService; prefixos exportados)
export const HANDOFF_PREFIX = 'handoff:state'; THREAD_PREFIX = 'handoff:thread'; CONTACT_PREFIX = 'handoff:contact'; DESK_EVENT_PREFIX = 'handoff:desk-event';
class HandoffRepository {
  getState(phone): Promise<HandoffState | null>; saveState(phone, state): Promise<void>; clearState(phone): Promise<void>;
  getThread(phone): Promise<DeskThread | null>; saveThread(phone, thread): Promise<void>; clearThread(phone): Promise<void>;
  getContact(phone): Promise<DeskContact | null>; saveContact(phone, contact): Promise<void>;
  claimDeskMessage(messageId: number): Promise<boolean>; // setIfAbsent 24 h; erro do Redis → true
}

// desk.gateway.ts (injeta CHATWOOT_CLIENT: ChatwootClient | null)
class DeskGateway {
  get enabled(): boolean;
  ensureContact(phone: string, name: string | undefined, cached: DeskContact | null): Promise<DeskContact>;
  openConversation(contact: DeskContact): Promise<number>;           // status 'pending'
  postIncoming(conversationId: number, text: string): Promise<void>;
  postOutgoing(conversationId: number, text: string): Promise<void>;
  postNote(conversationId: number, text: string): Promise<void>;
  setStatus(conversationId: number, status: 'open' | 'pending' | 'resolved'): Promise<void>;
}
```
TTL: estado e thread 604_800 s; contato 2_592_000 s. `ensureContact`: com `cached` devolve direto;
senão `findContact(phone)`; existe e tem `sourceIds[inboxId]` → usa; existe sem → `createContactInbox(id, phone)`;
não existe → `createContact({ name: name ?? phone, identifier: phone, phoneNumber: '+' + phone, sourceId: phone })`.
(O gateway precisa do `inboxId`: injetar `CHATWOOT_CONFIG`.)

Nota (linhas separadas por `\n`, só as presentes): `Transferido para atendente` / `Motivo: …` /
sem resumo → `Sem pedido em andamento.`; `identityConfirmed: false` → `Identidade não confirmada: confirme com o cliente antes de passar dados do pedido.` e **nada mais**; senão `Etapa: …`,
`Cliente: … (cliente novo)` quando `newCustomer`, `Produto: 2× Botijão P13`, `Endereço: …`,
`Pagamento: …`, `Total: R$ 220,00` (`formatMoney`).

- [ ] **Step 1: Testes**
  - nota completa (valores do exemplo acima); identidade não confirmada com `customerName` preenchido **não** mostra o nome; resumo nulo; a nota nunca contém 11 dígitos seguidos (`expect(note).not.toMatch(/\d{11}/)`).
  - repositório (mock do `RedisService` como em `conversation.repository.spec.ts`): prefixos, TTLs e `claimDeskMessage` true na 1ª e false na 2ª.
  - gateway com `FakeChatwootClient`: contato novo criado com `identifier` e `+telefone`; contato existente sem a caixa ganha `contact_inbox`; `cached` não chama o cliente; `openConversation` cria `pending`; `enabled` false com cliente null.
- [ ] **Step 2:** `pnpm test src/modules/handoff` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm test` e `pnpm lint` → PASS.
- [ ] **Step 5:** `git commit -m "feat(handoff): estado no Redis, nota de resumo e gateway do Chatwoot"`

---

### Task 5: `HandoffService` e `HandoffModule`

**Files:**
- Create: `src/modules/handoff/handoff.service.ts` (+spec), `handoff.module.ts`

**Interfaces:**
- Consumes: Task 1 (`parseServiceHours`, `isOpenAt`, `nextOpening`, `hideCpfs`), Task 4 inteira.
- Produces:
```ts
class HandoffService {
  constructor(repo: HandoffRepository, desk: DeskGateway, logger: PinoLogger, clock?: { now(): Date }, hours?: ServiceWindow[]);
  serviceHours(): ServiceHoursInfo;
  requestHandoff(request: HandoffRequest): Promise<HandoffOutcome>;
  routeFor(phone: string): Promise<'bot' | 'agent'>;
  forwardToAgent(phone: string, inbound: DeskInbound): Promise<void>;
  recordTurn(turn: TurnRecord): Promise<void>;
  markAgentMessage(phone: string, conversationId: number): Promise<{ becameActive: boolean }>;
  endFromDesk(phone: string, conversationId: number): Promise<void>;
  noteWindowClosed(conversationId: number): Promise<void>;
  claimDeskMessage(messageId: number): Promise<boolean>;
}
export interface TurnRecord { phone: string; name?: string; inbound: DeskInbound; sensitive: boolean;
  botMessages: string[]; newCycle: boolean; ended: boolean; saleId?: number }
```
No módulo, `hours` vem de `parseServiceHours(env.SERVICE_HOURS ?? '')` e `clock` de `{ now: () => new Date() }`
(providers com token próprio ou `useFactory`). `HandoffModule` importa `CacheModule` e
`ChatwootModule`; exporta `HandoffService`.

Regras (todas as chamadas ao Chatwoot em `try/catch` com log `warn` `{ component: 'handoff', from: maskPhone(phone), error: kind }`):
- `activeState(phone)` (privado): lê o estado; expirado (`active` e `now - lastAgentAt > 24 h`, ou
  `queued` e `now - since > 72 h`) → `postNote(EXPIRED_NOTE)` + `setStatus('resolved')` (melhor esforço),
  `clearState` + `clearThread`, devolve null.
- `requestHandoff`: desligado → `unavailable`. Estado `queued` → `alreadyQueued`; `active` → `active`.
  Senão: thread (cria contato/conversa se não houver), `postNote(handoffNote(...))`,
  `setStatus('open')`, `saveState({ status: 'queued', conversationId, reason, since: now })`. Qualquer
  erro → `unavailable` e nada é salvo. `open`/`nextOpening` sempre preenchidos pelo horário.
- `routeFor`: estado `active` → `'agent'`, senão `'bot'` (erro → `'bot'`).
- `forwardToAgent`: posta `deskText(inbound, false)` como `incoming` na conversa do estado.
- `deskText(inbound, sensitive)`: `sensitive` → `[CPF ocultado]`; texto → `hideCpfs`; choice → título
  (com `hideCpfs`); unsupported → regra 11 das decisões.
- `recordTurn`: desligado → nada. Sem handoff + `newCycle` + thread guardada → resolve a antiga e
  `clearThread`. Garante thread, posta a entrada (`incoming`) e cada `botMessages` (`outgoing`).
  Depois: `saleId` e estado `queued` → `postNote(saleNote)`, `setStatus('resolved')`, `clearState`,
  `clearThread`; senão `ended` e sem handoff → `setStatus('resolved')` + `clearThread`.
- `markAgentMessage`: grava `{ status: 'active', conversationId, reason: anterior ?? 'agent', since: anterior?.status === 'active' ? anterior.since : now, lastAgentAt: now }` e `saveThread({ conversationId })`; `becameActive` = estado anterior não era `active`.
- `endFromDesk`: apaga estado se `state.conversationId === conversationId`; apaga thread se `thread.conversationId === conversationId`; ids diferentes → nada.

- [ ] **Step 1: Testes** (repositório em memória + `FakeChatwootClient` real dentro do `DeskGateway`, relógio fixo `2026-11-09T10:00:00-03:00`)
  - entra na fila: conversa `open`, nota com o motivo, estado `queued`, resultado `{ status: 'queued', open: true, nextOpening: null }`.
  - segunda chamada → `alreadyQueued`, sem nota nova.
  - fora do horário (relógio domingo 10:00, horário `seg-sex 08:00-18:00`) → `open: false`, `nextOpening: { weekday: 1, time: '08:00', inDays: 1 }`.
  - `failNext()` no Chatwoot → `unavailable` e estado não salvo; desligado (cliente null) → `unavailable`.
  - `recordTurn` com `sensitive: true` posta `[CPF ocultado]`; texto `'meu cpf é 123.456.789-09'` vira `'meu cpf é [CPF ocultado]'`; nenhuma mensagem do fake contém `/\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2}/`.
  - `recordTurn` com falha do Chatwoot não lança.
  - venda criada na fila: nota `Venda #4521 criada pelo bot, saiu da fila.`, conversa `resolved`, estado e thread apagados.
  - `ended` sem handoff resolve e esquece a thread; `newCycle` com thread antiga resolve a antiga e cria outra `pending`.
  - `markAgentMessage` de `queued` → `becameActive: true`; segunda vez → false; `routeFor` → `'agent'`.
  - `active` com `lastAgentAt` 24 h + 1 min atrás → `routeFor` `'bot'`, nota `EXPIRED_NOTE`, conversa `resolved`.
  - `queued` com 72 h + 1 min → expira igual.
  - `endFromDesk` com id antigo não apaga o estado atual; com o id certo apaga.
  - `forwardToAgent` com `{ type: 'unsupported', originalType: 'audio' }` → `[cliente enviou áudio]`.
- [ ] **Step 2:** `pnpm test src/modules/handoff` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm test` e `pnpm lint` → PASS.
- [ ] **Step 5:** `git commit -m "feat(handoff): fila, espelho e fim do handoff no HandoffService"`

---

### Task 6: Fluxo — `requestHandoff`, gatilhos e textos

**Files:**
- Create: `src/modules/conversation/flow/handoff.ts`, `flow/handoff.spec.ts`
- Modify: `flow/flow.types.ts`, `flow/testing/fake-tools.ts`, `flow/global-commands.ts` (+spec), `flow/steps/summary.step.ts` (+spec), `flow/messages.ts`, `flow-tools.ts` (+spec), `conversation.module.ts` (importa `HandoffModule`)

**Interfaces:**
- Consumes: `HandoffRequest`, `HandoffOutcome`, `HandoffReason`, `HandoffOrderSummary`, `ServiceHoursInfo` (Task 4), `Opening` (Task 1), `HandoffService.requestHandoff/serviceHours` (Task 5).
- Produces:
```ts
// flow.types.ts — FlowTools
requestHandoff(request: HandoffRequest): Promise<HandoffOutcome>;
serviceHours(): Promise<ServiceHoursInfo>;
export const CPF_STEPS: readonly Step[] = ['askCpf', 'askCpfPrefix'];
// flow/handoff.ts
export const HANDOFF_CHOICE = 'handoff:request';
export function handoffButton(): ReplyOption;                          // { id: HANDOFF_CHOICE, title: msg.talkToAgent }
export function handoffSummary(state: OrderState | null): HandoffOrderSummary | null;
export function handoff(state: OrderState | null, phone: string, reason: HandoffReason, tools: FlowTools): Promise<StepResult>;
// messages.ts
talkToAgent: 'Falar com atendente',
handoffQueued: 'Já chamei um atendente. Enquanto isso, posso continuar te ajudando por aqui.',
handoffAlreadyQueued: 'Você já está na fila, um atendente vai te chamar.',
handoffClosed: (opening: Opening | null) => string,
```
`handoffClosed`: `Estamos fechados agora. Abrimos ${quando}. Quando abrirmos, mande um "oi" aqui que um atendente te responde.`;
`quando` = `hoje às 8h` (inDays 0) / `amanhã às 8h` (1) / `segunda às 8h30` (nome do dia:
domingo, segunda, terça, quarta, quinta, sexta, sábado); hora `08:00`→`8h`, `08:30`→`8h30`. Sem
`opening` → `Estamos fechados agora. Quando abrirmos, mande um "oi" aqui que um atendente te responde.`

`handoff()` devolve `{ state, replies: [uma mensagem] }`: `queued`+aberto → `handoffQueued`;
`queued`+fechado → `handoffClosed(nextOpening)`; `alreadyQueued`/`active` → `handoffAlreadyQueued`;
`unavailable` → `msg.talkToStore(tools.storePhone)`.
`handoffSummary`: null → null; `askCpfPrefix` → `{ stepLabel, identityConfirmed: false, newCustomer: false }`;
demais → `identityConfirmed: true`, `newCustomer: customer.id === undefined`, `customerName`,
`product: product?.name`, `quantity`, `address: msg.addressFull(address)`, `payment` (rótulo, com
`(troco para R$ X)` quando houver), `total: quote?.total`. **Nunca** lê `customer.cpf`.
`stepLabel` de um `Record<Step, string>` em português (ex.: `summary` → `Resumo do pedido`,
`saleFailed` → `Falha ao criar a venda`, `askCpfPrefix` → `Confirmação de identidade`).

`globalCommand`: palavras de `STORE` → `handoff(state, input.phone, 'customer_request', tools)`;
`choice` com id `handoff:request` → idem com `state?.step === 'saleFailed' ? 'sale_failed' : 'customer_request'`
(checar antes do `textOf`). `saleFailed` ganha o segundo botão `handoffButton()`.
`flow-tools.ts`: `requestHandoff: request => this.handoff.requestHandoff(request)`,
`serviceHours: async () => this.handoff.serviceHours()`. Fake-tools: `requestHandoff` →
`{ status: 'queued', open: true, nextOpening: null }`; `serviceHours` → `{ open: true, nextOpening: null, windows: [] }`.

- [ ] **Step 1: Testes**
  - `handoff.spec.ts`: cada `status` → texto certo; fechado com `{ weekday: 1, time: '08:00', inDays: 2 }` → contém `Abrimos segunda às 8h`; `{ time: '08:30', inDays: 1 }` → `amanhã às 8h30`; `handoffSummary` de `askCpfPrefix` com nome e CPF no estado → sem `customerName` e `JSON.stringify` sem `12345678909`; estado de resumo completo → produto, quantidade, total, endereço.
  - `global-commands.spec.ts`: `'quero falar com um atendente'` chama `requestHandoff` com `reason: 'customer_request'` e mantém o estado; choice `handoff:request` em `saleFailed` → `reason: 'sale_failed'`; fake devolvendo `unavailable` → `msg.talkToStore('86999990000')`.
  - `summary.step.spec.ts`: `saleFailed` mostra botões `retry:sale` e `handoff:request`.
  - `flow-tools.spec.ts`: liga `requestHandoff`/`serviceHours` ao serviço.
- [ ] **Step 2:** `pnpm test src/modules/conversation` → FAIL.
- [ ] **Step 3:** Implementar. Atualizar specs existentes que esperam `msg.talkToStore` para `atendente`.
- [ ] **Step 4:** `pnpm test` e `pnpm lint` → PASS.
- [ ] **Step 5:** `git commit -m "feat(conversation): pedido de atendente e falha da venda entram na fila (F07)"`

---

### Task 7: `ConversationService` — roteamento e espelho

**Files:**
- Create: `src/modules/conversation/reply-text.ts` (+spec)
- Modify: `contracts/conversation.types.ts`, `conversation.service.ts` (+spec)

**Interfaces:**
- Consumes: `HandoffService.routeFor/forwardToAgent/recordTurn` (Task 5), `CPF_STEPS` (Task 6).
- Produces: `replyText(reply: Reply): string` — texto puro; botões: corpo + `\n` + `[Título]` por linha; lista: corpo + `\n` + `- Título (descrição)` por opção. `IncomingContent` unsupported ganha `originalType?: string` (preenchido em `toIncoming`).

Dentro do `withPhoneLock`: `routeFor(phone) === 'agent'` → `forwardToAgent(phone, inbound)` e para
(sem fluxo, sem pedido, sem lembrete, sem resposta). Senão `advance` (passa a devolver também `before`
e o `StepResult`), `sendAll`, e então `recordTurn({ phone, name, inbound, sensitive: CPF_STEPS.includes(before?.step), botMessages: replies.map(replyText), newCycle: before === null, ended: result.state === null, saleId })`.
`inbound` (`DeskInbound`) sai de `IncomingContent` (choice usa `title ?? id`).

- [ ] **Step 1: Testes** (mock de `HandoffService` no `setup()`)
  - `routeFor` `'agent'` → `runFlow` não é chamado, `whatsapp.sent` vazio, `forwardToAgent` com o texto, `saveOrder`/`scheduleReminder` não chamados, `markAsRead` chamado.
  - turno normal → `recordTurn` depois do envio (ordem: `whatsapp.sent` já tem a resposta quando `recordTurn` roda), com `newCycle: true` sem pedido carregado e `botMessages: ['olá']`.
  - pedido carregado em `askCpf` → `sensitive: true`.
  - `recordTurn` rejeitando não impede o envio nem lança de `handle`.
  - `reply-text.spec.ts`: botões e lista.
- [ ] **Step 2:** `pnpm test src/modules/conversation` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm test` e `pnpm lint` → PASS.
- [ ] **Step 5:** `git commit -m "feat(conversation): repasse ao atendente e espelho das conversas no Chatwoot"`

---

### Task 8: Webhook do Chatwoot no `ConversationModule` + e2e

**Files:**
- Create: `src/modules/conversation/desk-events.service.ts` (+spec), `desk-webhook.controller.ts`, `docs/desk-webhook.doc.ts`, `tests/conversation/chatwoot-webhook.e2e.spec.ts`
- Modify: `conversation.module.ts` (controller, `ChatwootModule`, provider), `vitest.config.e2e.ts`

**Interfaces:**
- Consumes: `CHATWOOT_WEBHOOK`/`ChatwootWebhook` (Task 3), `HandoffService` (Task 5), `ConversationRepository.withPhoneLock/clearOrder/cancelReminder`, `MessagingGateway.send`.
- Produces: `DeskEventsService.handle(events: DeskEvent[]): Promise<void>`; rota `POST /webhooks/chatwoot` → `200 { received: true }`.

Controller (`@Public()`, `@Throttle(WEBHOOK_THROTTLE)`, `@ApiDoc` com 200/400/401, `rawBody`):
`isAuthentic(request.rawBody, header x-chatwoot-signature, header x-chatwoot-timestamp, Date.now())`
falso → `UnauthorizedError`; `parse(body) === null` → `BadRequestError`; senão `void handle(events)`.

`DeskEventsService` (cada evento em `try/catch`, log sem conteúdo): `phone === null` → ignora (debug).
`agentMessage`: `claimDeskMessage(messageId)` falso → ignora; `withPhoneLock(phone, …)`:
`markAgentMessage` → se `becameActive`, `clearOrder` + `cancelReminder`; envia texto
`*${agentName} (atendente):* ${content}` (cortado em 4096 com `truncate` de `src/utils/text`); erro
`WhatsappError` com `code === 131047` → `noteWindowClosed(conversationId)`.
`conversationResolved` → `withPhoneLock` + `endFromDesk`.

`vitest.config.e2e.ts`: `CHATWOOT_MODE: 'fake'`, `CHATWOOT_INBOX_ID: '1'`,
`CHATWOOT_WEBHOOK_SECRET: 'e2e-chatwoot-webhook-secret'`.

- [ ] **Step 1: Testes unitários** (`desk-events.service.spec.ts`, mocks como em `conversation.service.spec.ts`)
  - mensagem humana → `withPhoneLock` chamado antes de `clearOrder`; WhatsApp recebe `*Maria (atendente):* Olá, tudo bem?` para o telefone.
  - mesmo `messageId` duas vezes → um envio só.
  - já `active` (`becameActive: false`) → não apaga pedido; envia.
  - erro 131047 no envio → `noteWindowClosed`; outro erro → só log.
  - `conversationResolved` → `endFromDesk(phone, id)`.
- [ ] **Step 2: Testes e2e** (`chatwoot-webhook.e2e.spec.ts`, padrão de `whatsapp-webhook.e2e.spec.ts`; telefones aleatórios; limpar chaves `handoff:*`, `conversation:*`, `whatsapp:inbound:*` dos telefones/ids usados):
  - sem assinatura → 401; timestamp velho → 401; assinado com payload `"x"` → 400.
  - mensagem humana assinada → WhatsApp fake recebe `*Maria (atendente):* Olá` e `handoff:state:<phone>` fica `active`; nota privada e mensagem `agent_bot` → nada enviado.
  - fluxo completo: `atendente` pelo webhook do WhatsApp → resposta `msg.handoffQueued` e conversa `open` no `FakeChatwootClient` (`app.get(CHATWOOT_CLIENT)`); mensagem humana; depois `"oi"` do cliente → nenhuma resposta do bot e a mensagem aparece no fake; `resolvedWebhook` → próximo `"oi"` volta a ter resposta do bot.
- [ ] **Step 3:** `pnpm test` → FAIL nos novos.
- [ ] **Step 4:** Implementar. `pnpm test`, `pnpm lint`, `pnpm build` → PASS.
- [ ] **Step 5:** Pedir a vez: `maestri ask "maestro" "Posso rodar pnpm test:e2e no worktree do handoff (usa Postgres/Redis compartilhados)?"`; com o ok, `pnpm test:e2e` → PASS.
- [ ] **Step 6:** `git commit -m "feat(conversation): webhook do Chatwoot repassa o atendente ao WhatsApp"`

---

### Task 9: Chatwoot no Docker, guia e documentação

**Files:**
- Create: `docker/chatwoot.env.example`, `docs/guides/integrations/chatwoot.md`
- Modify: `docker-compose.yml`, `.gitignore` (`docker/chatwoot.env`), `package.json`, `CLAUDE.md`, `README.md`, `docs/README.md`, `docs/project/fluxo.md`, `docs/project/requisitos.md`, `docs/project/funcionalidades.md`, `docs/guides/conventions/environment.md`, `docs/guides/conventions/testing.md`, `docs/security/SECURITY.md`

Compose (todos com `profiles: ['chatwoot']`, `restart: unless-stopped`, `env_file: docker/chatwoot.env`
nos três que precisam):
- `chatwoot-postgres`: `pgvector/pgvector:pg16`, `POSTGRES_USER: postgres`, `POSTGRES_DB: chatwoot`, senha do env_file, volume `chatwoot_pg_data`, healthcheck `pg_isready`.
- `chatwoot-redis`: `redis:7-alpine`, `redis-server --appendonly yes` (sem `maxmemory-policy`), volume `chatwoot_redis_data`.
- `chatwoot-rails`: `chatwoot/chatwoot:v4.19.1-ce`, `entrypoint: docker/entrypoints/rails.sh`, `command: ['bundle','exec','rails','s','-p','3000','-b','0.0.0.0']`, `ports: ['127.0.0.1:3000:3000']`, `extra_hosts: ['host.docker.internal:host-gateway']`, volume `chatwoot_storage:/app/storage`, `depends_on` pg/redis healthy.
- `chatwoot-sidekiq`: mesma imagem, `command: ['bundle','exec','sidekiq','-C','config/sidekiq.yml']`, mesmo env/volume/extra_hosts.
`docker/chatwoot.env.example`: `SECRET_KEY_BASE=`, `FRONTEND_URL=http://localhost:3000`,
`ENABLE_ACCOUNT_SIGNUP=false`, `RAILS_ENV=production`, `NODE_ENV=production`,
`INSTALLATION_ENV=docker`, `RAILS_LOG_TO_STDOUT=true`, `POSTGRES_HOST=chatwoot-postgres`,
`POSTGRES_USERNAME=postgres`, `POSTGRES_PASSWORD=`, `POSTGRES_DATABASE=chatwoot`,
`REDIS_URL=redis://chatwoot-redis:6379`.
Scripts: `chatwoot:prepare` = `docker compose --profile chatwoot run --rm chatwoot-rails bundle exec rails db:chatwoot_prepare`;
`chatwoot:up` = `docker compose --profile chatwoot up -d chatwoot-rails chatwoot-sidekiq`;
`chatwoot:stop` = `docker compose --profile chatwoot stop chatwoot-rails chatwoot-sidekiq chatwoot-postgres chatwoot-redis`.

Guia `chatwoot.md` (mesmas seções dos outros guias): arquitetura B em 5 linhas; estrutura de pastas;
modos; subir (copiar env, `openssl rand -hex 64`, prepare, up, `curl -I localhost:3000/api`);
onboarding (admin + conta); caixa **API** com webhook `http://host.docker.internal:3100/webhooks/chatwoot`
e o segredo do canal → `CHATWOOT_WEBHOOK_SECRET`; **desligar atribuição automática** da caixa; criar
Agent Bot **sem conectar à caixa** → `CHATWOOT_BOT_TOKEN`; token do perfil admin →
`CHATWOOT_API_TOKEN`; ids da conta e da caixa (pela URL); `CHATWOOT_MODE=live`; não cadastrar
webhook da conta (eventos em dobro); estados do handoff; eco; CPF; erros; armadilhas (janela de 24 h,
`underscores_in_headers` se houver Nginx, upgrade de imagem = rodar `chatwoot:prepare` de novo).

Docs: `fluxo.md` (comandos globais, `saleFailed` com 2 botões, estados do handoff, espelho);
`requisitos.md` (RF11 volta ao escopo, ajustar "Sem atendente humano"); `funcionalidades.md` (F07
entregue, remover "Fora do MVP"); `environment.md` (seção Chatwoot + `SERVICE_HOURS`);
`testing.md` (`CHATWOOT_MODE=fake` no e2e, `app.get(CHATWOOT_CLIENT)`); `SECURITY.md` (rota
`/webhooks/chatwoot`, segredos novos, CPF ocultado, eco); `CLAUDE.md` (integração `chatwoot/`, módulo
`handoff/`, `core/erros/chatwoot/`, segredos, guia na lista, comandos `chatwoot:*`); `README.md` e
`docs/README.md` (guia novo).

- [ ] **Step 1:** Escrever compose, env example, `.gitignore`, scripts.
- [ ] **Step 2:** `docker compose config --services` → lista só `postgres` e `redis`; `docker compose --profile chatwoot config --services` → os seis. (Não sobe nada.)
- [ ] **Step 3:** Guia e docs. `pnpm lint` → PASS.
- [ ] **Step 4:** `git commit -m "docs: Chatwoot no Docker e guia do handoff (F07)"` (compose/scripts podem ir num `chore(docker): …` separado antes).

---

### Task 10: Verificação final

- [ ] `pnpm lint`, `pnpm test`, `pnpm build` verdes.
- [ ] `pnpm test:e2e` (pedir a vez antes) verde.
- [ ] Revisão do branch inteiro (`superpowers:requesting-code-review`), corrigir o que for confirmado.
- [ ] Opcional, só com ok do maestro: `pnpm chatwoot:prepare && pnpm chatwoot:up` e `curl -I localhost:3000/api` → 200. A configuração da caixa e dos tokens é manual (guia); sem tokens não há teste live, fica como pendência no relatório.
- [ ] Relatório final via `maestri ask "maestro" "<relatório>"`.
