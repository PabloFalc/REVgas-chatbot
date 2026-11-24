# Segurança

Referência viva das **decisões e práticas de segurança** do revgas-chatbot. Foca no que é
durável: vetores de ataque e suas mitigações, gestão de credenciais e escolhas de design com
impacto de segurança. Detalhe de implementação fica no código e nos guias de área
([environment.md](../guides/conventions/environment.md)).

> **Princípio geral:** *fail-closed* e **hardening por ambiente** — dev é permissivo para não
> atrapalhar o trabalho; produção é restrita e, em vários pontos, **não sobe** se mal configurada
> (ex.: `CORS_ORIGIN`). Toda config sensível é derivada de env, nunca hardcoded.

---

## Autenticação

- O projeto **não tem login nem sessão de usuário**. Não há rotas `/auth/*` nem guard global:
  toda rota é pública por padrão. Cada rota sensível se autentica por conta própria — o webhook
  do WhatsApp pela **assinatura do provedor** (ver [Webhook do WhatsApp](#webhook-do-whatsapp)),
  o do Chatwoot por `X-Chatwoot-Signature` e o Swagger por `DOC_TOKEN`.
- O header `authorization` (e `password`, `token`, `secret`…) é redigido nos logs (Pino).

## Origens & CORS

- **Fonte única** de origens em `src/config/origins.ts`, consumida pelo **CORS**
  (`cors.config.ts`).
- Comportamento por ambiente:
  - dev/test sem `CORS_ORIGIN` (ou `*`) → **aberto** (reflete a origem);
  - origem definida → **estrito** (só a lista);
  - **produção** → `CORS_ORIGIN` **obrigatório** e **sem `*`** (o schema de env barra no boot).

## Proxy & rate limiting

- `trustProxy` é derivado de **`TRUSTED_PROXY`** (`false` por padrão). Confiar no
  `X-Forwarded-For` de qualquer peer permitiria **spoof de IP** e **bypass do rate limit** (a
  chave do throttler é `req.ip`). Atrás de proxy/LB, configure o IP/CIDR do proxy (contagem de hops é recusada no boot). **Sem `TRUSTED_PROXY` atrás de um proxy, todos os clientes aparecem com o IP do proxy** e dividem o mesmo limite; defina o valor no deploy.
- Rate limit global (`@nestjs/throttler` + Redis): `default` 50/min; `/health` com `HEALTH_THROTTLE` (120/min); `/webhooks/whatsapp` com `WEBHOOK_THROTTLE`
  (1000/min, porque todo o tráfego vem dos IPs da Meta).

## Gestão de segredos

- `.env` **fora do git** (`.gitignore`); o `.env.example` só tem placeholders.
- O CI (`tests.yml`) só tem **valores de teste** para serviços efêmeros do runner; segredos reais
  de produção nunca entram nos workflows.
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
- **Redis:** `REDIS_PASSWORD` (obrigatória em produção, o boot falha sem ela) e `REDIS_TLS` (ligue
  em produção com Redis gerenciado). Sem senha, o Redis (rate limit e estado das conversas) fica aberto a quem alcança a porta.
  O `docker-compose.yml` configura `maxmemory-policy noeviction`: com memória cheia o Redis recusa
  gravações em vez de apagar chaves (trava, bloqueio de CPF, estado do pedido). Em produção, use a
  mesma política; `allkeys-*` poderia apagar o bloqueio de CPF.
- `REVGAS_MODE=live` cria vendas reais no ERP e só sobe com `REVGAS_ALLOW_LIVE_SALES=true`, para
  que ninguém ligue vendas reais sem querer.
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
- **LGPD nos logs:** erros do Redis registram só nome e mensagem do erro, nunca os argumentos do
  comando, porque a chave leva telefone ou CPF (ex.: bloqueio e contadores por telefone). Telefone
  é mascarado nos logs de webhook, envio e limitador.

## Resiliência / disponibilidade

- **Redis é a dependência crítica:** `/health` responde 503 sem ele; Postgres fora só marca o serviço
  como degradado (o fluxo de pedido não depende do Postgres, só a base de conhecimento).
- **Trava por telefone nunca é ignorada:** se não for obtida em 120 s, o bot pede que o cliente reenvie
  a mensagem em vez de processar sem a trava (evita dois pedidos concorrentes do mesmo telefone).
- **Falha do Redis não é engolida** no estado do pedido, no bloqueio de CPF e no estado do handoff:
  o bot responde "instabilidade". Engolir o erro faria o bloqueio de CPF falhar aberto. O limitador de
  IA continua deixando a chamada passar (ver abaixo).

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
- **Estado do pedido só com o prefixo de 3 dígitos do CPF** para cliente conhecido; no cliente novo, o
  CPF inteiro sai do estado logo depois do cadastro.
- **Limitação conhecida:** são ~1000 combinações de 3 dígitos e 3 tentativas por hora por telefone. É lento,
  mas possível para quem controla o telefone ou tem tempo. Bloqueio progressivo (tempo crescente a cada
  rodada) é trabalho futuro. O prefixo sozinho não expõe o CPF, mas libera endereços e pedidos do cliente.
- Os 3 dígitos digitados nunca vão ao log nem ao prompt da IA (blocos soltos de 3 dígitos são removidos do texto livre; CPFs inteiros são removidos por `removeCpfs` antes de qualquer chamada à IA).

## Webhook do WhatsApp

- Todo `POST /webhooks/whatsapp` tem o `X-Hub-Signature-256` conferido (HMAC-SHA256 do corpo cru
  com `WHATSAPP_APP_SECRET`, comparação em tempo constante) antes de qualquer processamento;
  inválido → 401. O segredo é obrigatório em `live` e em produção (o boot falha sem ele); só em
  `fake` fora de produção a checagem pode ser pulada. Corpo que não é JSON não tem corpo cru e
  recebe 401.
- Eventos de outro `phone_number_id`, ou sem ele, são descartados.
- Com `WHATSAPP_ALLOWED_SENDERS` preenchida, mensagens de números fora da lista são descartadas logo
  depois da assinatura, antes do dedup, da IA e do fluxo: não são lidas nem respondidas e geram um
  log `warn` com o telefone mascarado. Status de entrega não são filtrados. Em produção com vendas
  simuladas (`REVGAS_MODE` diferente de `live`) a lista é obrigatória e o boot falha sem ela, para
  que uma implantação de teste não atenda desconhecidos.
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
- **Checagens de saída:** a resposta é descartada se estiver vazia, passar de 600 caracteres (1200
  em pedido de lista ou resumo), não
  citar trechos ou citar id inexistente, tiver `R$`/"reais"/"centavos" ou `%`/"por cento", usar
  palavra de preço que não está nos trechos citados, trouxer nome próprio (palavra com maiúscula
  fora do começo de frase, como um bairro inventado: `name_not_in_sources`) que não está neles,
  ou trouxer número (algarismo ou por extenso) que não está neles. A base não guarda valores,
  porcentagens, horários nem formas de pagamento.
- **Pedido amplo com as mesmas regras:** lista, resumo, comparação e passo a passo mandam mais
  trechos (a base inteira quando tem até 20 trechos, senão os 8 melhores da busca) e aceitam até
  1200 caracteres, mas passam pelas mesmas checagens. Só a numeração de lista no começo da linha
  (`1.`, `2)`) deixa de contar como número; a palavra depois de `- ` continua checada como nome, para
  barrar bairro inventado numa lista.
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
- **Filtro de palavrões no código:** antes de qualquer etapa (e na primeira mensagem), depois só da
  emergência, `src/utils/profanity.ts` procura palavrões por palavra inteira, sem acento, com letras
  repetidas juntadas e troca de números e símbolos por letras ("p0rra", "c@ralho"). Se casar, o bot
  responde com o texto fixo de ofensa e repete a pergunta da etapa, sem gravar nada: nome, rua,
  bairro, número e busca de produto nunca recebem palavrão, mesmo sem IA. A ofensa pela IA continua
  como segunda camada. **Decisão do usuário (2026-11-15).**
- **Nome lido pela IA com conferência no código:** em `askName`, a IA (`readName`, custo 1 no limite
  por telefone) tira o nome de frases como "meu nome é João Silva". O texto vai sem CPF
  (`removeCpfs`) e com as regras mandando tratá-lo como dado. O nome só é aceito se a IA disser que
  parece nome de pessoa, tiver nome e sobrenome e todas as palavras estiverem no texto do cliente,
  então a IA não consegue inventar nem completar um nome. Sem IA, vale a validação de sempre.
- **Lista de assuntos sem IA:** "quais dúvidas posso tirar?" responde com os títulos das seções da
  base e os assuntos do código, sem busca, sem IA e sem texto do cliente no prompt.
- **Cliente travado:** 3 "não entendi" seguidos oferecem o atendente. Contadores no Redis, fora do
  estado do pedido, sem texto do cliente.
- **Limite de IA por telefone:** `AI_CALLS_PER_PHONE_HOUR` (padrão 30 por hora; interpretar custa 1,
  ler endereço em texto livre custa 1, responder dúvida custa 2), contado no Redis. Acima do limite
  ou quando o contador falha, a chamada de IA é bloqueada e o bot continua com os botões do fluxo;
  no endereço, pede o endereço de novo. O log leva só o telefone mascarado e o nome do erro, nunca
  os argumentos do comando, que incluem a chave com o telefone.
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

## Retenção e acesso no Chatwoot

O Chatwoot espelha **cada turno** da conversa (mensagens do cliente e do bot), não só as de handoff.
O CPF é ocultado (`[CPF ocultado]`), mas nome, endereço, telefone e o que o cliente escrever ficam lá.
Ainda não há política definida. A definir com a revenda antes de produção:

- por quanto tempo guardar as conversas e como apagá-las a pedido do titular (LGPD);
- quem tem conta de atendente ou administrador e com que permissão;
- onde o Chatwoot roda e como é feito o backup, já que ele guarda o próprio Postgres.

## Itens em aberto

- **Performance** (não-segurança): compressão brotli em respostas pequenas (PERF-05) — avaliar
  priorizar `gzip` no dinâmico / subir o `threshold`. **Medir antes de mudar.**


## Métricas do bot

`bot_events` guarda apenas colunas tipadas de classificação, data, duração e contagem. Não recebe telefone, nome, CPF, endereço, mensagens, ids de cliente/venda da RevGás ou texto livre de erros. `cycle_id` é um UUID aleatório, sem derivação do telefone. A correlação temporal com outros logs ainda pode identificar uma atividade; restrinja o acesso e a exportação.

A retenção padrão é de 180 dias, com limpeza na inicialização e a cada 24 horas. `METRICS_ENABLED=false` desliga tanto a gravação quanto a limpeza. Revise a retenção conforme a finalidade do tratamento; ausência de PII direta não elimina o risco de correlação.

O Metabase só escuta em `127.0.0.1:3001`, com telemetria anônima desligada e banco de configuração separado. Segredos ficam em `docker/metabase.env`, fora do Git. A conexão analítica usa `metrics_reader`, com SELECT apenas em `bot_events`, até dez conexões e timeout de 10 segundos. Não conecte o Metabase com o usuário administrativo da aplicação. Guia: [métricas](../guides/modules/metrics.md).
