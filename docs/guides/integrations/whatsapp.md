# Integração WhatsApp (`src/integrations/whatsapp`)

Canal do chatbot: **Cloud API oficial da Meta**. A integração tem duas partes:

- **Envio** (`WhatsappClient`): texto, botões de resposta, lista interativa e "marcar como lida".
- **Webhook** (`WhatsappWebhook`): verificação da Meta, conferência da assinatura e leitura dos
  eventos (mensagens recebidas e status de entrega).

Quem usa as duas é o módulo `src/modules/conversation`, que expõe a rota `/webhooks/whatsapp`.
A integração não conhece o domínio e nunca importa `src/modules/`.

> **Estado atual:** o bot ainda não tem o fluxo de pedido. Ele responde com uma **resposta de
> teste** para provar a conexão: ecoa o texto, `lista` devolve uma lista de produtos de exemplo,
> `botões` devolve três botões e a escolha volta confirmada. A máquina de estados do pedido
> substitui a função `replyTo` (em `conversation.service.ts`) depois.

## Estrutura

```
src/integrations/whatsapp/
  shared/        whatsapp.config (modo e variáveis)
  messages/      messages.schemas (limites do WhatsApp em Zod), messages.payload (corpo da Graph API)
  webhook/       webhook.schemas, webhook.parser (payload → eventos), signature (HMAC),
                 whatsapp-webhook (challenge, assinatura, filtro por número)
  testing/       webhook.testing.ts (payloads de exemplo; só para testes, fora do build)
  whatsapp.client.ts            interface WhatsappClient e token WHATSAPP_CLIENT
  cloud-api-whatsapp.client.ts  cliente real (POST /{versão}/{phone_number_id}/messages)
  fake-whatsapp.client.ts       simulador em memória (guarda o que foi enviado)
  whatsapp.factory.ts           createWhatsappClient / createWhatsappWebhook
  whatsapp.module.ts            WhatsappModule (provê WHATSAPP_CLIENT e WHATSAPP_WEBHOOK)

src/modules/conversation/
  conversation.controller.ts    GET/POST /webhooks/whatsapp
  conversation.service.ts       handle(): dedup → marcar lida → resposta → envio;
                                replyTo(): decide a resposta (função pura, sem I/O)
  conversation.repository.ts    dedup de mensagens no Redis (24h)
  messaging.gateway.ts          envia as respostas pelo WhatsappClient (saída, não guarda nada)
  contracts/                    formatos de entrada e saída do módulo
    conversation.types.ts       IncomingMessage (mensagem já traduzida) e Reply (resposta do bot)
    verification-query.dto.ts   query validada do GET de verificação da Meta
  docs/                         @ApiDoc das rotas
```

## Modos (`WHATSAPP_MODE`)

| Modo | O que faz |
| --- | --- |
| `live` | Envia pela Cloud API. Exige `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN`. |
| `fake` | Nada sai para o WhatsApp. O que seria enviado fica em memória e aparece no log (com o texto, fora de produção). Não exige nada. |

Padrão (variável vazia): `live` se houver `WHATSAPP_ACCESS_TOKEN`, senão `fake`. Os testes e2e
forçam `fake` em `vitest.config.e2e.ts`, então nunca mandam mensagem de verdade. Variáveis:
[environment.md](../conventions/environment.md#whatsapp-cloud-api-da-meta).

## Configurar na Meta (primeira vez)

1. Em [developers.facebook.com](https://developers.facebook.com), crie um app do tipo **Empresa**
   e adicione o produto **WhatsApp**.
2. Em **WhatsApp → Configuração da API** (API Setup) a Meta cria um **número de teste**. Copie:
   - **Identificação do número de telefone** (Phone number ID) → `WHATSAPP_PHONE_NUMBER_ID`
   - **Token de acesso temporário** → `WHATSAPP_ACCESS_TOKEN` (expira em 24h)
3. Ainda nessa tela, em **Para** (To), cadastre o celular de quem vai testar (até 5 números) e
   confirme o código que chega no WhatsApp. O número de teste **só conversa com números cadastrados**.
4. Em **Configurações do app → Básico**, copie a **Chave secreta do app** → `WHATSAPP_APP_SECRET`.
5. Invente um verify token (`openssl rand -hex 16`) → `WHATSAPP_VERIFY_TOKEN`.
6. Suba o app (`pnpm start:dev`) e exponha a porta com um túnel HTTPS:
   ```bash
   cloudflared tunnel --url http://localhost:3100
   # ou: ngrok http 3100
   ```
7. Em **WhatsApp → Configuração** (Configuration) → **Webhook**: URL de callback
   `https://<endereço-do-túnel>/webhooks/whatsapp` e o mesmo verify token. Clique em
   **Verificar e salvar**; a Meta chama o `GET` e espera o `hub.challenge` de volta.
8. Ainda em Webhook, **assine o campo `messages`** (sem isso nenhuma mensagem chega).
9. Do celular cadastrado, mande `oi` para o número de teste. O bot responde; mande `lista` e
   `botões` para testar as mensagens interativas.

O endereço do túnel muda a cada execução do `cloudflared`/`ngrok` grátis; quando mudar, atualize a
URL na Meta (passo 7).

**Produção:** o token temporário não serve. Gere um token de **usuário do sistema** no
Gerenciador de Negócios (permissões `whatsapp_business_messaging` e
`whatsapp_business_management`) e use um número real registrado na conta.

## Testar sem a Meta

Com `WHATSAPP_MODE=fake` e sem `WHATSAPP_APP_SECRET` (só fora de produção), o webhook aceita POST
sem assinatura:

```bash
curl -X POST localhost:3100/webhooks/whatsapp -H 'Content-Type: application/json' -d '{
  "object": "whatsapp_business_account",
  "entry": [{ "changes": [{ "field": "messages", "value": {
    "contacts": [{ "wa_id": "5586999991234", "profile": { "name": "Teste" } }],
    "messages": [{ "from": "5586999991234", "id": "wamid.teste.1", "type": "text", "text": { "body": "lista" } }]
  } }] }]
}'
```

A resposta que seria enviada aparece no log (`whatsapp fake send`). Troque o `id` a cada envio:
ids repetidos são ignorados por 24h.

## Webhook

- `GET /webhooks/whatsapp`: devolve `hub.challenge` em texto puro se `hub.mode=subscribe` e o
  `hub.verify_token` conferir; senão 403. Query inválida (parâmetro repetido, mais de 256
  caracteres) → 400. O verify token é mascarado nos logs de requisição.
- `POST /webhooks/whatsapp`:
  1. Confere `X-Hub-Signature-256` (HMAC-SHA256 do **corpo cru** com o app secret). Inválida → 401.
     Por isso o app sobe com `rawBody: true` (`main.ts` e `tests/setup-e2e.ts`).
     Corpo que não é JSON (ex.: `text/plain`) não tem corpo cru e também recebe 401.
  2. Lê os eventos. Payloads que não são do WhatsApp, campos diferentes de `messages` e eventos de
     outro `phone_number_id` (ou sem ele) são ignorados.
  3. Responde `200 { received: true }` na hora e processa em segundo plano. Falhas vão para o log e
     nunca derrubam os outros eventos do lote.
  4. Para cada mensagem: descarta se o id já foi visto (Redis, 24h; a Meta reenvia quando não
     recebe 200 a tempo), marca como lida, calcula a resposta e envia.
- Status de entrega: `failed` gera aviso no log com os códigos de erro; os demais só em debug.
- Rate limit próprio (`WEBHOOK_THROTTLE`, 1000/min), porque todo o tráfego vem dos IPs da Meta.

Limitações conhecidas (aceitas por enquanto):

- **Processamento em memória:** se o processo cair depois do 200 e antes do envio, a resposta se
  perde, e o reenvio da Meta é descartado porque o id já foi registrado. Quando o fluxo de pedido
  entrar, trocar por uma fila (ou marcar "processando" com TTL curto e "feito" no fim).
- **Redis fora:** `setIfAbsent` lança erro (diferente de `get`/`set`, que engolem). O repositório
  trata isso e processa sem dedup, mas na prática o rate limit, que usa o mesmo Redis, já falha
  antes com 500.
- **Dependência do domínio na integração:** o `ConversationService` importa os tipos de evento de
  `integrations/whatsapp/webhook/webhook.schemas` (só tipos) e o `WhatsappError` de
  `src/core/erros/whatsapp`. Se outro canal entrar, mover a tradução dos eventos para
  `contracts/` e um gateway.

## Limites das mensagens

Validados com Zod antes de chamar a API (`WhatsappInvalidMessageError`, nada é enviado):

| Tipo | Limite |
| --- | --- |
| Texto | 1–4096 caracteres |
| Corpo de botões/lista | 1–1024; header e footer até 60 |
| Botões | 1–3, título até 20, ids únicos |
| Lista | texto do botão até 20; até 10 seções e **10 opções no total**; título da opção até 24, descrição até 72; com mais de uma seção, todas precisam de título |
| Destinatário | `wa_id`: só dígitos com DDI (8–15) |

## Erros

Ficam em `src/core/erros/whatsapp/whatsapp.errors.ts` (com `mapWhatsappError` e
`graphErrorDetails`). Todos estendem `WhatsappError` (campos `kind`, `status` e `code`).

| Erro (`kind`) | Quando |
| --- | --- |
| `invalid_message` | Mensagem fora dos limites acima (antes de chamar a API) |
| `unauthorized` | 401 ou código 190: token inválido ou expirado |
| `rate_limited` | 429 ou códigos 4, 80007, 130429, 131048, 131056 |
| `rejected` | Outros 4xx; o `code` da Meta fica em `error.code` |
| `unavailable` | 5xx |
| `response` | 200 sem id de mensagem |
| `unknown_outcome` | Timeout ou erro de rede: a mensagem pode ter saído |

Envios **nunca são repetidos** automaticamente (evita mensagem duplicada para o cliente).

Códigos comuns da Meta: `131030` (destinatário fora da lista do número de teste), `131047` (fora
da janela de 24h; só template), `190` (token expirado), `100` (parâmetro inválido).

## Armadilhas

- **Janela de 24h:** o bot só manda texto livre até 24h depois da última mensagem do cliente.
  Fora disso, só template aprovado (afeta lembrete de recompra e recuperação de carrinho).
- **Nono dígito:** o `wa_id` de celulares brasileiros pode chegar **sem o 9** (ex.:
  `558699991234`). Responda sempre para o `from` recebido; ao buscar o cliente na RevGás, considere
  as duas formas.
- **Logs:** telefone sempre mascarado (`*******1234`), sem token e sem o texto das mensagens (o
  texto só aparece no modo `fake` fora de produção).
