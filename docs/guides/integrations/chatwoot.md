# Integração Chatwoot (`src/integrations/chatwoot`)

Mesa do atendente da revenda: o **Chatwoot** (open source) recebe as conversas que o bot transfere
(F07) e espelha as demais. Versão fixada: `chatwoot/chatwoot:v4.19.1-ce`.

Arquitetura (opção B), em resumo:

- O webhook da Meta continua chegando no **nosso bot**; o número de WhatsApp **não** é conectado ao
  Chatwoot.
- O Chatwoot entra por uma caixa do tipo **API**. O bot copia para ela as mensagens do cliente
  (entrada), as suas respostas (saída) e as notas internas.
- Quando um atendente responde pelo Chatwoot, o webhook **da caixa** avisa o bot
  (`POST /webhooks/chatwoot`), que repassa o texto ao cliente pelo WhatsApp.
- Enquanto o cliente está só na fila, o bot continua atendendo; ele se cala quando o atendente manda
  a primeira mensagem.
- Quem usa tudo isso é `src/modules/handoff` (estado e regras) e `src/modules/conversation` (rota do
  webhook e fluxo). A integração não conhece o domínio e nunca importa `src/modules/`.

Design: `docs/superpowers/specs/2026-11-09-handoff-chatwoot-design.md`.

## Estrutura

```
src/integrations/chatwoot/
  shared/          chatwoot.config (modo, variáveis e checagem do modo live)
  webhook/         webhook.schemas (Zod do payload), signature (HMAC + idade do timestamp),
                   chatwoot-webhook (assinatura, filtro de caixa/telefone, eco → DeskEvent)
  testing/         webhook.testing.ts (payloads de exemplo; só para testes, fora do build)
  chatwoot.client.ts       interface ChatwootClient e token CHATWOOT_CLIENT
  http-chatwoot.client.ts  cliente real (API REST do Chatwoot, respostas validadas por Zod)
  fake-chatwoot.client.ts  simulador em memória
  chatwoot.factory.ts      createChatwootClient / createChatwootWebhook
  chatwoot.module.ts       ChatwootModule

src/core/erros/chatwoot/   ChatwootError e mapChatwootError

src/modules/handoff/
  handoff.service.ts       fila, espelho, fim e expiração do handoff
  handoff.repository.ts    estado, conversa atual, contato e dedup no Redis
  desk.gateway.ts          saída para o Chatwoot (o serviço não importa integrations/)
  contracts/               tipos (HandoffReason, HandoffState…) e a nota de resumo (handoff-note.ts)

src/modules/conversation/
  desk-webhook.controller.ts  POST /webhooks/chatwoot
  desk-events.service.ts      mensagem do atendente → WhatsApp; conversa resolvida → fim do handoff
  flow/handoff.ts             resposta ao pedido de atendente (HANDOFF_CHOICE = 'handoff:request')

src/utils/service-hours.ts    parseServiceHours, isOpenAt, nextOpening (horário de atendimento)
```

A rota do webhook do Chatwoot fica no `ConversationModule`; o `RoutesModule` continua importando só
ele.

## Modos (`CHATWOOT_MODE`)

| Modo | O que faz |
| --- | --- |
| `live` | Fala com o Chatwoot real. Exige `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_INBOX_ID`, `CHATWOOT_API_TOKEN`, `CHATWOOT_BOT_TOKEN` e `CHATWOOT_WEBHOOK_SECRET`. |
| `fake` | Simulador em memória, sem rede. Usado nos testes. |
| `off` | Sem Chatwoot: o pedido de atendente responde com o telefone da revenda (`STORE_PHONE`), não há espelho e o webhook responde 401. |

Padrão (variável vazia): `live` se houver `CHATWOOT_API_TOKEN`, senão `off`. Os testes e2e forçam
`fake` em `vitest.config.e2e.ts`. Variáveis:
[environment.md](../conventions/environment.md#chatwoot-handoff-para-atendente).

## Subir o Chatwoot local (Docker)

Os quatro serviços (`chatwoot-postgres`, `chatwoot-redis`, `chatwoot-rails`, `chatwoot-sidekiq`) ficam
no profile **`chatwoot`** do `docker-compose.yml`, então `pnpm docker:init` e a CI não os sobem. Têm
Postgres (com pgvector) e Redis próprios: o Redis do bot usa `allkeys-lru`, que pode apagar filas do
Sidekiq. Os contêineres se chamam `revgas-chatwoot-pg`, `revgas-chatwoot-redis`,
`revgas-chatwoot-rails` e `revgas-chatwoot-sidekiq`.

1. Crie o arquivo de segredos (fica fora do git, está no `.gitignore`):
   ```bash
   cp docker/chatwoot.env.example docker/chatwoot.env
   ```
2. Preencha `SECRET_KEY_BASE` (`openssl rand -hex 64`) e `POSTGRES_PASSWORD` (uma senha forte).
3. Prepare o banco (cria o schema e roda as migrações):
   ```bash
   pnpm chatwoot:prepare
   ```
4. Suba:
   ```bash
   pnpm chatwoot:up
   ```
   Sobem `chatwoot-rails` e `chatwoot-sidekiq`; Postgres e Redis entram por dependência.
5. Confira (a primeira subida demora alguns minutos):
   ```bash
   curl -I localhost:3000/api
   ```
6. Para parar: `pnpm chatwoot:stop`.

Os scripts `chatwoot:*` sempre nomeiam os serviços, então não mexem no Postgres e no Redis do bot.
A porta é `127.0.0.1:3000` (o bot usa `3100`).

**Upgrade de imagem:** ao trocar a versão no compose, rode `pnpm chatwoot:prepare` de novo antes de
subir (migrações novas).

## Configurar o Chatwoot (primeira vez)

1. Abra `http://localhost:3000`, crie o **administrador** e a **conta** (o cadastro público fica
   desligado: `ENABLE_ACCOUNT_SIGNUP=false`).
2. **Caixa de entrada → Adicionar → API.** Em **URL do webhook** use
   `http://host.docker.internal:3100/webhooks/chatwoot` (o contêiner alcança o bot no host; o compose
   define `host.docker.internal`). Em produção, use a URL pública do bot.
3. Copie o **segredo do canal** da caixa (configurações da caixa; visível só a administradores e pode
   ser rotacionado). Ele assina os webhooks → `CHATWOOT_WEBHOOK_SECRET` (mínimo 16 caracteres).
4. Ainda nas configurações da caixa, **desligue a atribuição automática**, senão o Chatwoot atribui
   a conversa a alguém antes de o atendente assumir.
5. **Configurações → Integrações → Agent Bots**: crie um bot e copie o token → `CHATWOOT_BOT_TOKEN`.
   **Não conecte o bot à caixa**: conectado, a caixa força o status `pending` e manda eventos para o
   URL do bot. Aqui ele serve só como identidade de remetente das mensagens do bot.
6. **Perfil do administrador → Token de acesso** → `CHATWOOT_API_TOKEN`. O token do bot não acessa
   contatos no v4.19.1, por isso este segundo token existe; ele é usado só para contatos.
7. Os ids da conta e da caixa aparecem na URL do painel: `/app/accounts/<ACCOUNT_ID>/inbox/<INBOX_ID>`
   → `CHATWOOT_ACCOUNT_ID` e `CHATWOOT_INBOX_ID`.
8. No `.env` do bot: `CHATWOOT_MODE=live` (ou vazio, já que há `CHATWOOT_API_TOKEN`) e reinicie.
9. Convide os atendentes (Configurações → Agentes) e adicione-os à caixa.

**Não cadastre também um webhook da conta** (Configurações → Integrações → Webhooks): os eventos
chegariam em dobro.

## Como funciona

### Estados do handoff

O estado fica no Redis, por telefone, separado do pedido (que expira em 15 min).

| Estado | Quem fala com o cliente | Como entra | Como sai |
| --- | --- | --- | --- |
| (nenhum) | Bot | — | Pedido de atendente → `queued`; mensagem humana no Chatwoot → `active` |
| `queued` | Bot (normal) | Botão ou palavra de pedido de atendente; falha da venda | 1ª mensagem humana → `active`; venda criada pelo bot → nenhum; conversa resolvida no Chatwoot → nenhum; 72 h → nenhum |
| `active` | Atendente (o bot só repassa ao Chatwoot) | 1ª mensagem humana | Conversa resolvida no Chatwoot → nenhum; 24 h sem mensagem do atendente → nenhum |

- **Gatilhos:** o botão "Falar com atendente" (id `handoff:request`, comando global, vale em qualquer
  etapa), as palavras de `global-commands.ts` (`atendente`, `falar com alguem`, `humano`) e a etapa
  `saleFailed` ("Tentar de novo" ou "Falar com atendente"). Os guard rails usam o mesmo ponto de
  entrada (`FlowTools.requestHandoff`) com outros motivos.
- **Entrada na fila:** o bot cria ou reaproveita o contato e a conversa, muda para `open` (sem
  atendente) e deixa uma nota interna com o resumo (motivo, etapa, produto, quantidade, endereço,
  pagamento, total, nome). Sem CPF. Se a identidade ainda não foi confirmada, a nota diz isso e não
  leva nome, endereço nem pedido. A resposta ao cliente é só o texto do handoff, sem repetir a
  pergunta da etapa.
- **Fora do horário** (`SERVICE_HOURS`, fuso fixo `America/Fortaleza`): o bot avisa que está
  fechado, diz quando abre e pede que o cliente mande "oi" quando abrir. Segue na fila.
- **Ao virar `active`:** o pedido em andamento e o lembrete são apagados. As mensagens do cliente vão
  só para o Chatwoot e o bot não responde. Mensagens não suportadas viram `[cliente enviou áudio]`
  etc.
- **Mensagem do atendente → WhatsApp:** `*Maria (atendente):* texto`. Notas internas não vão ao
  cliente. Se a Meta recusar por janela de 24 h (código 131047), o bot deixa uma nota avisando.
- **Venda criada pelo bot em `queued`:** resolve a conversa com a nota "Venda #N criada pelo bot,
  saiu da fila." e apaga o estado. "Cancelar" não tira o cliente da fila.
- **Expiração:** preguiçosa, conferida quando o cliente escreve ou o handoff é consultado (sem
  varredura). Ao expirar: nota "Handoff expirado, o bot voltou a atender.", conversa resolvida
  (melhor esforço) e estado apagado.
- **Chaves no Redis:** estado e conversa atual com TTL de 7 dias, contato 30 dias, dedup de mensagem
  do atendente 24 h.

### Espelho das conversas

- Toda mensagem do cliente e toda resposta do bot são copiadas para a conversa do telefone: as do
  cliente como entrada, as do bot como saída (token do Agent Bot). Botões e listas viram texto.
- **Uma conversa por ciclo.** Enquanto só o bot atende, ela fica `pending`. Quando o pedido termina
  sem handoff (venda criada, cancelado, expirado), o bot a resolve; a próxima mensagem abre outra.
  Nunca postamos em conversa resolvida (no v4.19.1 isso a reabriria como `open`).
- O espelho roda **depois** do envio ao WhatsApp, dentro do lock do telefone, com timeout curto
  (`CHATWOOT_TIMEOUT_MS`) e erros engolidos (log `warn`). O Chatwoot fora do ar nunca atrasa nem
  derruba a resposta ao cliente.

### Eco

As mensagens que o próprio bot copia também disparam webhook. Só é "mensagem humana" o evento
`message_created` com `message_type = outgoing`, `private = false` e `sender.type = user`. O bot
aparece como `agent_bot`, as do cliente são `incoming` e as notas são privadas, então nenhuma volta
ao cliente. Há ainda dedup pelo id da mensagem.

### CPF

Dígitos de CPF **nunca** chegam ao Chatwoot. Nas etapas `askCpf` e `askCpfPrefix` a mensagem do
cliente vai como `[CPF ocultado]`; em qualquer etapa, trechos que casam com o padrão de CPF
(`src/utils/cpf`) são trocados pelo mesmo texto. A nota de resumo não tem campo de CPF.

## Webhook

`POST /webhooks/chatwoot` (público, com `WEBHOOK_THROTTLE`):

1. Confere `X-Chatwoot-Signature: sha256=<hex>`: HMAC-SHA256 de `` `${timestamp}.${corpo cru}` ``
   com `CHATWOOT_WEBHOOK_SECRET`, em tempo constante. O corpo cru exige `rawBody: true` (já ligado
   em `main.ts` e `tests/setup-e2e.ts`).
2. O Chatwoot não confere a idade do `X-Chatwoot-Timestamp` (segundos Unix); **nós** recusamos
   diferença maior que **300 s**.
3. Sem segredo configurado (ou modo `off`), recusa tudo: 401. Nunca aceita sem assinatura.
4. Valida o payload com Zod (inválido → 400), descarta eventos de outra caixa (`inbox_id` diferente
   de `CHATWOOT_INBOX_ID`) e de telefone que não case com `/^\d{8,15}$/`. O telefone vem de
   `conversation.meta.sender.identifier` (criamos o contato com `identifier = wa_id`), com fallback
   para `conversation.contact_inbox.source_id`.
5. Responde `200 { received: true }` e processa em segundo plano, sob o lock do telefone.

Eventos tratados: `message_created` (mensagem do atendente) e `conversation_status_changed` para
`resolved`. O resto é ignorado.

## Erros

`src/core/erros/chatwoot/chatwoot.errors.ts`. Todos estendem `ChatwootError` (`kind`, `status`).

| Erro (`kind`) | Quando |
| --- | --- |
| `unauthorized` | 401 ou 403: token inválido |
| `not_found` | 404: conversa ou contato não existe |
| `rejected` | Outros 4xx |
| `unavailable` | 5xx |
| `response` | Resposta fora do formato esperado (Zod) |
| `unknown_outcome` | Timeout ou erro de rede: a chamada pode ter sido feita |

Nenhuma chamada é repetida automaticamente (nunca reenviar POST). Se o Chatwoot falha ao entrar na
fila, o cliente recebe a resposta antiga com o telefone da revenda.

## Testar

`pnpm test` e `pnpm test:e2e` usam `CHATWOOT_MODE=fake` e não precisam do Chatwoot. Para ver o que o
bot enviou ao Chatwoot nos e2e, pegue o simulador com `app.get(CHATWOOT_CLIENT)`; exemplo em
`tests/conversation/chatwoot-webhook.e2e.spec.ts`.

## Limitações conhecidas

- **Expiração preguiçosa:** só é conferida quando o cliente escreve ou o handoff é consultado; sem
  varredura periódica.
- **Espelho de melhor esforço:** uma queda do Chatwoot perde as mensagens espelhadas, e em `active`
  uma mensagem do cliente é descartada (com `warn` no log) se não puder ser entregue.
- **Sem anexos** (imagem, áudio, documento) nos dois sentidos; só texto.
- **Sem templates da Meta:** fora da janela de 24 h o atendente não consegue escrever primeiro.
- **Teste real pendente:** o fluxo ainda não foi exercitado contra um Chatwoot de verdade (exige a
  configuração manual da caixa e dos tokens acima). Os testes usam o fake.

## Armadilhas

- **Janela de 24 h da Meta:** o atendente só escreve até 24 h depois da última mensagem do cliente;
  por isso o bot pede que o cliente mande "oi" quando a revenda abrir.
- **Atrás de Nginx**, ative `underscores_in_headers on;`, senão o header `api_access_token` das
  chamadas à API se perde.
- **Webhook da conta + da caixa:** eventos em dobro; use só o da caixa.
- **Segredo da caixa rotacionado:** atualize `CHATWOOT_WEBHOOK_SECRET` e reinicie o bot.
- **Agent Bot conectado à caixa** muda o status das conversas e o destino dos eventos; mantenha-o
  desconectado.
- **Logs:** telefone sempre mascarado (`maskPhone`), sem tokens e sem o texto das mensagens.
