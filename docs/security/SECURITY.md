# Segurança

Referência viva das **decisões e práticas de segurança** do revgas-chatbot. Foca no que é
durável: vetores de ataque e suas mitigações, gestão de credenciais e escolhas de design com
impacto de segurança. Detalhe de implementação fica no código e nos guias de área
([auth.md](../guides/modules/auth.md), [environment.md](../guides/conventions/environment.md)).

> **Princípio geral:** *fail-closed* e **hardening por ambiente** — dev é permissivo para não
> atrapalhar o trabalho; produção é restrita e, em vários pontos, **não sobe** se mal configurada
> (ex.: `CORS_ORIGIN`). Toda config sensível é derivada de env, nunca hardcoded.

---

## Autenticação & sessão

- Auth via **Better Auth** (singleton em `src/modules/auth/auth.ts`), só para o login do futuro
  painel da revenda (F08); detalhes em [auth.md](../guides/modules/auth.md).
- **Standby:** a auth (e o `EmailService`) está no código mas **desligada** — `RoutesModule` não
  importa o `AuthModule`, então não há rotas `/auth/*` nem **guard global**: hoje toda rota é
  pública por padrão. O webhook do WhatsApp (futuro) deve ser autenticado pela **assinatura do
  provedor**. Ao ligar a auth, o `AuthGuard` passa a valer em todas as rotas e as públicas
  precisam de `@Public()`.
- **Só token Bearer** (plugin `bearer()`): o cliente envia `Authorization: Bearer <token>`.
  **Não há cookies** — logo não há superfície de **CSRF** (nenhuma credencial é anexada
  automaticamente pelo browser). Contrapartida: o painel deve guardar o token com cuidado
  (exposição a **XSS** se ficar em local legível por JS).
- Com a auth ligada, o `AuthGuard` (provido pelo `AuthModule`, não pelo `CoreModule`) é
  **fail-closed**: por padrão exige sessão **e** email verificado (`403` sem verificação).
  Liberação explícita via `@Public` / `@AllowAnonymous` / `@AllowUnverified`.
- Links de email (verify) validam o `callbackURL` contra a allowlist de origens
  (`isTrustedCallbackURL`) para evitar **open redirect**; o `redirectTo` do reset é validado pelo
  `trustedOrigins` do Better Auth.
- Sessão expira em 7 dias. Leitura servida do **Redis** (`secondaryStorage`); **Postgres é a fonte
  de verdade** (`storeSessionInDatabase`). `cookieCache` desligado.
- O header `authorization` (e `password`, `token`, `secret`…) é redigido nos logs (Pino).

## Origens & CORS

- **Fonte única** de origens em `src/config/origins.ts`, consumida pelo **CORS**
  (`cors.config.ts`), pelo **`trustedOrigins`** do Better Auth e pela validação de `callbackURL`.
- Comportamento por ambiente:
  - dev/test sem `CORS_ORIGIN` (ou `*`) → **aberto** (reflete a origem);
  - origem definida → **estrito** (só a lista);
  - **produção** → `CORS_ORIGIN` **obrigatório** e **sem `*`** (o schema de env barra no boot).

## Proxy & rate limiting

- `trustProxy` é derivado de **`TRUSTED_PROXY`** (`false` por padrão). Confiar no
  `X-Forwarded-For` de qualquer peer permitiria **spoof de IP** e **bypass do rate limit** (a
  chave do throttler é `req.ip`). Atrás de proxy/LB, configure o IP/CIDR do proxy (contagem de hops é recusada no boot).
- Rate limit global (`@nestjs/throttler` + Redis): `default` 50/min; `sign-in`/`sign-up` com
  `STRICT_AUTH_THROTTLE` (10/min, bloqueio 5min); `/health` com `HEALTH_THROTTLE` (120/min); `/webhooks/whatsapp` com `WEBHOOK_THROTTLE`
  (1000/min, porque todo o tráfego vem dos IPs da Meta).

## Gestão de segredos

- `.env` **fora do git** (`.gitignore`); o `.env.example` só tem placeholders.
- O CI (`tests.yml`) só tem **valores de teste** para serviços efêmeros do runner; segredos reais
  de produção nunca entram nos workflows.
- `BETTER_AUTH_SECRET` é opcional enquanto a auth está em standby; quando preenchida exige
  **≥ 32 chars** (validado no schema de env).
- **Resend:** `RESEND_API_KEY` opcional (standby). Em dev/test o envio é log-only por padrão, para
  não disparar tokens de verificação/reset para destinatários reais.
- **API Key da RevGás (`REVGAS_API_KEY`) fica só no servidor** (RNF02): nunca vai para o front,
  para o prompt da IA, para respostas da API nem para logs. Vazada, permite criar/consultar vendas
  no ERP da revenda.
- **WhatsApp:** `WHATSAPP_ACCESS_TOKEN` só no header da chamada server-side (nunca em log);
  `WHATSAPP_APP_SECRET` confere a assinatura do webhook; `WHATSAPP_VERIFY_TOKEN` comparado em tempo
  constante.
- **Chatwoot:** `CHATWOOT_API_TOKEN` e `CHATWOOT_BOT_TOKEN` só no header (`api_access_token`) da
  chamada server-side; `CHATWOOT_WEBHOOK_SECRET` confere a assinatura do webhook. Nunca em log,
  resposta ou prompt. O Chatwoot local guarda os seus próprios segredos (`SECRET_KEY_BASE`, senha do
  Postgres) em `docker/chatwoot.env`, fora do git; só o `.example` é versionado.
- **LLM:** `LLM_API_KEY` só no header da chamada server-side; nunca em log, erro, resposta HTTP nem
  prompt. Os logs da integração não levam prompt, resposta nem a mensagem de erro do provedor.
  **No plano gratuito do Gemini as mensagens vão ao Google e podem ser usadas para treino**
  (decisão aceita em 2026-10-20): mande à IA só o texto necessário e nunca CPF. Ver
  [llm.md](../guides/integrations/llm.md).
- **Embedding:** `EMBEDDING_API_KEY` (cai em `LLM_API_KEY` se vazia) segue as mesmas regras: só no
  header da chamada server-side, nunca em log, erro, resposta HTTP nem prompt. O log do embedding
  leva só a operação, o modelo, o status e a contagem de textos.
- **Redis:** `REDIS_PASSWORD` e `REDIS_TLS` (opcionais em dev, obrigatórios na prática em prod) —
  sem auth, o Redis (sessões, rate limit e estado das conversas) fica aberto a quem alcança a porta.
- **Swagger** protegido por `DOC_TOKEN` (header `x-doc-token`) e não montado em produção.

## Headers & transporte

- Helmet (`helmet.config.ts`): **CSP** restritiva (sem `unsafe-eval`; `unsafe-inline` só em dev p/
  Swagger), **HSTS** explícito (1 ano, `includeSubDomains`, `preload`).

## Não-vazamento de informação

- Erros **mascarados em produção**: `debugDetails()` (`src/core/erros/debug-details.ts`) só
  devolve payload de debug fora de prod — usado no filtro do Drizzle (sem SQL/params em prod) e no
  filtro de exceções inesperadas (sem stack/mensagem interna).
- `/health` público devolve só `{status,timestamp,uptime}` em produção; o detalhe por subsistema
  (`checks`) só aparece fora de prod (`publicHealth`).
- Logs: segredos redigidos em todos os ambientes; `email` redigido em produção.

## Resiliência / disponibilidade

- Pool do Postgres com limites + `statement_timeout` (vars `DB_*`) mitigam **DoS por query lenta**
  / exaustão de conexões.
- `@fastify/under-pressure` responde `503` acima dos limites de memória (`PRESSURE_MAX_*`).

## Verificação de identidade (CPF)

- Cliente reconhecido pelo telefone só vê endereços e pedidos depois de digitar os 3 primeiros
  dígitos do CPF. Mitiga o número de telefone que mudou de dono expondo os dados do anterior.
- **Chave por telefone + id do cliente na RevGás**, validade de 15 dias: se o telefone passar a
  identificar outro cliente, a verificação anterior não vale.
- **Bloqueio contra chute:** 3 erros em 1 h bloqueiam o telefone por 1 h (contador e bloqueio no
  Redis). Só entrada só numérica (dígitos, espaços, pontos ou traços) com exatamente 3 dígitos
  conta como tentativa; texto de pedido com letras ("2 P13") nunca conta.
- Cliente sem CPF no cadastro, ou bloqueado, recebe só o telefone da revenda; nada do cadastro é mostrado.
- Os 3 dígitos digitados nunca vão ao log nem ao prompt da IA (blocos soltos de 3 dígitos são removidos do texto livre; CPFs inteiros são removidos por `removeCpfs` antes de qualquer chamada à IA).

## Webhook do WhatsApp

- Todo `POST /webhooks/whatsapp` tem o `X-Hub-Signature-256` conferido (HMAC-SHA256 do corpo cru
  com `WHATSAPP_APP_SECRET`, comparação em tempo constante) antes de qualquer processamento;
  inválido → 401. O segredo é obrigatório em `live` e em produção (o boot falha sem ele); só em
  `fake` fora de produção a checagem pode ser pulada. Corpo que não é JSON não tem corpo cru e
  recebe 401.
- Eventos de outro `phone_number_id`, ou sem ele, são descartados.
- Query da verificação validada (strings de até 256 caracteres; repetida → 400).
- Responde 200 assim que a assinatura confere e processa em segundo plano, então envios lentos à
  Graph API não prendem a conexão da Meta.
- Reenvios da Meta são deduplicados pelo id da mensagem no Redis (24h), para não responder duas
  vezes.
- Logs do webhook e dos envios: telefone mascarado (`*******1234`), sem corpo das mensagens nem
  token (o conteúdo só aparece no log do modo `fake` fora de produção).

## IA e base de conhecimento

Camadas que protegem as respostas da IA sobre a base ([knowledge.md](../guides/modules/knowledge.md)).

Respostas da base (módulo ligado ao fluxo):

- **Corte de relevância:** só entram trechos com similaridade mínima; sem trecho, a IA nem é chamada.
- **Pergunta higienizada:** CPF (`removeCpfs`), dígitos que vêm até 3 palavras depois de "cpf"
  (`removeCpfMentions`, pega pedaço de CPF como "meu cpf termina em 0909") e qualquer sequência de
  8 dígitos ou mais (`removeLongDigitRuns`, inclui celular e fixo) saem do texto, que é cortado em
  500 caracteres antes do embedding e do prompt.
- **Trechos e pergunta como dado:** vão escapados em `<trecho>`, com regras fixas mandando ignorar
  ordens dentro deles; a IA responde `{ answer, sources }` validado por Zod.
- **Checagens de saída:** a resposta é descartada se estiver vazia, passar de 600 caracteres, não
  citar trechos ou citar id inexistente, tiver `R$`/"reais"/"centavos" ou `%`/"por cento", usar
  palavra de preço que não está nos trechos citados, trouxer nome próprio (palavra com maiúscula
  fora do começo de frase, como um bairro inventado: `name_not_in_sources`) que não está neles,
  ou trouxer número (algarismo ou por extenso) que não está neles. A base não guarda valores,
  porcentagens, horários nem formas de pagamento.
- **Falha vira "não sei":** Postgres, embedding ou IA fora do ar nunca lançam; o resultado é
  `unknown` com log de aviso. Uma tentativa por chamada, sem retry.
- **Sem texto do cliente no log:** só motivo, rejeição, quantidade de trechos e nome do erro.
- **Isolamento por modelo:** a busca só compara vetores do modelo de embedding atual. Índice sem
  trecho do modelo atual gera aviso `index_empty` no log.
- **Vetores reais protegidos:** `kb:ingest` em modo fake recusa sobrescrever índice com vetores de
  outro modelo sem `--force`, e o CLI não imprime query nem parâmetros do Drizzle.
- **`rag:check` só em dev:** recusa `NODE_ENV=production` e banco com trecho de fonte fora da base
  fictícia, para nunca sobrescrever a base real de staging ou produção.
- **Medição de invenção:** as perguntas da checagem podem ter `forbidden`; resposta que traz um
  desses termos (por exemplo um bairro fora da lista) conta como violação.

Guard rails do fluxo (entregues, etapa B):

- **Emergência de gás sem IA:** vazamento ou cheiro de gás (`flow/emergency.ts`, frases mais regra de
  proximidade entre palavra de gás e de vazamento) é tratado antes de qualquer comando, em qualquer
  etapa e sem pedido em andamento. Resposta: texto fixo de segurança (Bombeiros, 193) e fila do
  atendente com o motivo `emergency`; se o cliente já está na fila (`queued`), o bot também deixa a
  nota interna "Emergência: cliente relatou possível vazamento de gás" no Chatwoot.
  **Decisão do usuário (2026-11-10):** com o atendente no controle (`active`) o bot fica em
  silêncio: não manda o texto de segurança, repassa a mensagem e deixa a mesma nota interna. Falha
  do Chatwoot vira aviso no log e não impede o repasse.
- **Só `order` altera o pedido:** dúvida, preço, fora do assunto e ofensa nunca chamam
  `applyInterpretation`; texto de cliente não muda produto, quantidade nem pagamento por essas
  intenções.
- **Preço só pelo código:** a IA apenas classifica a pergunta; o texto vem do acordo base da RevGás.
  A base não guarda valores e as checagens de saída descartam `R$` e `%`.
- **Horário e pagamento pelo código:** `SERVICE_HOURS` e as formas ativas da RevGás, nunca a base
  nem a IA.
- **Recusa e ofensa com texto fixo:** fora do assunto recebe recusa fixa; ofensa recebe texto fixo e,
  da 2ª vez, a oferta de atendente. O atendente só entra por toque no botão.
- **Cliente travado:** 3 "não entendi" seguidos oferecem o atendente. Contadores no Redis, fora do
  estado do pedido, sem texto do cliente.
- **Limite de IA por telefone:** `AI_CALLS_PER_PHONE_HOUR` (padrão 30 por hora; interpretar custa 1,
  ler endereço em texto livre custa 1, responder dúvida custa 2), contado no Redis. Acima do limite
  o bot segue sem IA, com log de aviso e telefone mascarado. Falha do Redis no limitador deixa a
  chamada passar (aviso no log só com o telefone mascarado e o nome do erro, nunca os argumentos do
  comando, que levam a chave com o telefone), para não derrubar o atendimento.
- **Produto que não vendemos:** o item citado pela IA é limpo (só letras, números, espaço e hífen,
  até 30 caracteres) antes de ir na resposta.
- Os cortes de relevância da busca ainda não foram calibrados (ver
  [knowledge.md](../guides/modules/knowledge.md#valores-calibrados)).

## Webhook do Chatwoot

- `POST /webhooks/chatwoot` confere `X-Chatwoot-Signature` (HMAC-SHA256 de `timestamp.corpo cru`
  com `CHATWOOT_WEBHOOK_SECRET`, comparação em tempo constante) antes de qualquer processamento;
  inválida → 401. O Chatwoot não confere a idade do timestamp, então recusamos diferença maior que
  300 s (repetição de requisição capturada). Sem segredo configurado, ou com o modo `off`, recusa
  tudo: nunca aceita sem assinatura.
- Payload validado com Zod (inválido → 400); eventos de outra caixa ou com telefone fora de
  `/^\d{8,15}$/` são descartados. Responde 200 e processa em segundo plano, com `WEBHOOK_THROTTLE`.
- **Eco/loop:** só mensagens de saída, não privadas e de remetente humano (`sender.type = user`) vão
  ao cliente; as do bot (`agent_bot`), as copiadas do cliente e as notas privadas nunca voltam.
  Dedup pelo id da mensagem.
- **CPF não vai ao Chatwoot:** `[CPF ocultado]` nas etapas de CPF e em qualquer trecho com padrão de
  CPF; a nota de resumo não tem campo de CPF.
- Nunca reenviar POST ao Chatwoot automaticamente. Logs com telefone mascarado, sem tokens e sem o
  texto das mensagens.
- Não cadastrar webhook da conta além do da caixa (eventos em dobro).

## Planejado (chatbot)

Itens que entram junto com os módulos do chatbot (ver [specs.md](../project/specs.md) e
[requisitos.md](../project/requisitos.md)):

- **LGPD — mascaramento nos logs:** CPF, telefone e endereço dos clientes mascarados em todo log
  (chamadas à API RevGás, handoffs, erros). Hoje a redaction do Pino cobre só segredos e `email`.
- **Cliente `integrations/revgas`:** API Key injetada só no header da chamada server-side; retry com
  backoff apenas em 5xx/timeout e com idempotência para não duplicar vendas.
- **IA:** o prompt nunca recebe a API Key nem dados de outros clientes; saída validada com Zod.

## Extensões com impacto de segurança

- **Login social (OAuth):** não está no escopo. Se for adicionado, as colunas
  `access_token`/`refresh_token`/`id_token` em `accounts` são gravadas em **texto plano** —
  **ative a criptografia de tokens do Better Auth** ao habilitar OAuth.

## Itens em aberto

- **Performance** (não-segurança): compressão brotli em respostas pequenas (PERF-05) — avaliar
  priorizar `gzip` no dinâmico / subir o `threshold`. **Medir antes de mudar.**
