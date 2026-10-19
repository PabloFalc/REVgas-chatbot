# Variáveis de ambiente

A configuração do app é **validada no boot** por um schema Zod em `src/config/env.ts` (a **fonte
da verdade**). O `process.env` é parseado uma vez; se algo obrigatório faltar ou for inválido, a
aplicação **não sobe** (fail-closed). Todo o código importa `env` desse módulo — nunca lê
`process.env` direto.

> **Onde fica o quê.** O `.env` é **local e ignorado pelo git** (nunca o commite). O
> [`.env.example`](../../../.env.example) é o template versionado, só com **placeholders** — copie-o
> para `.env` e preencha. Em produção, use **secrets** do servidor/CI, nunca um arquivo no repo.

## Convenções de tipo

- **Booleanos** usam `z.stringbool()` — aceitam `true/false`, `1/0`, `yes/no`. (Evita o problema
  do `z.coerce.boolean()`, que trata `"false"` como `true`.)
- **Números** são coeridos de string (`z.coerce.number()`).
- **Obrigatória** = sem `default` no schema → o boot falha se ausente. **Opcional** = tem default
  ou é `optional()`.

---

## Núcleo / servidor

| Variável | Obrigatória | Default | Função e consequências |
|---|---|---|---|
| `NODE_ENV` | Não | `development` | `development` \| `production` \| `test`. Controla hardening por ambiente (máscara de erros, `/health` enxuto, throttle real, Swagger desligado em produção, email log-only em `test`). Valor errado relaxa proteções de produção. |
| `PORT` | Não | `3100` | Porta HTTP. |
| `HOST` | Não | `0.0.0.0` | Interface de bind. `0.0.0.0` aceita conexões externas (necessário em container). |
| `LOG_LEVEL` | Não | por `NODE_ENV` (ver abaixo) | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent`. Sobrescreve o nível do logger (Pino). Sem ela, o default é `debug` em dev, `info` em produção e `silent` em test. Use para subir/baixar a verbosidade sem editar código — ex.: `LOG_LEVEL=trace` ao caçar um bug, ou `LOG_LEVEL=debug` para ligar logs ao depurar um teste. |

> **Logger (`src/config/plugins/pino.config.ts`).** Em **dev** a saída é colorida e legível
> (`pino-pretty`, prefixo `[Contexto]`); em **produção** é JSON estruturado; em **test** é silenciada
> por padrão. Use o estilo *object-first* do Pino (`logger.info({ component, ... }, 'mensagem')`) —
> em código injete `PinoLogger` do `nestjs-pino`; fora do DI use `createLogger(contexto)`.
> **Redaction:** segredos (`authorization`, `cookie`, `password`, `token`, `secret`) viram
> `[REDACTED]` em **todos** os ambientes; PII (`email`, `to`) é redigida **só em produção** (visível
> em dev/test para facilitar o debug). **Planejado (LGPD):** mascarar também CPF, telefone e endereço
> dos clientes do chatbot nos logs. Os exception filters logam apenas campos seguros
> (`name`/`code`/`message`/`stack`), nunca o erro ou o `body` da request cru.

## Better Auth (standby)

> A auth está em standby (ver [auth.md](../modules/auth.md#status-standby)). Estas variáveis só
> importam quando ela for ligada.

| Variável | Obrigatória | Default | Função e consequências |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | Não (standby; **sim** com a auth ligada) | vazio = não definida | Chave de assinatura dos tokens de sessão do Better Auth. Quando preenchida, **mín. 32 chars** (senão o boot falha). Se vazar, **sessões podem ser forjadas**. Gere com `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | Não | `http://localhost:3100` | URL base da API; base do link de verificação de email (`/auth/email/verify`). Em produção, aponte para a URL pública real (ex.: `https://api.exemplo.com`). |

## CORS & proxy

| Variável | Obrigatória | Default | Função e consequências |
|---|---|---|---|
| `CORS_ORIGIN` | **Em produção** | vazio (modo aberto em dev) | Allowlist de origens (lista separada por vírgula). É a **fonte única** do CORS, do `trustedOrigins` do Better Auth e da validação de `callbackURL`. Em dev vazio/`*` → modo aberto. Em **produção é obrigatória e não pode conter `*`** (o boot falha — ver [refinamentos](#validações-de-boot)). Ex.: `https://app.exemplo.com,https://admin.exemplo.com`. |
| `TRUSTED_PROXY` | Não | vazio (não confia) | Confiança no `X-Forwarded-For`. Vazio = `trustProxy:false`. Confiar em qualquer peer permite **spoof de IP** e **bypass do rate limit** (a chave do throttler é `req.ip`). Atrás de proxy/LB informe o **IP/CIDR** do proxy. Contagem de hops (`1`) é **recusada no boot**: desde o Fastify 5.12 ela não confia em nenhum proxy, o que quebraria o rate limit sem aviso. |

## Banco de dados (Postgres)

| Variável | Obrigatória | Default | Função e consequências |
|---|---|---|---|
| `DATABASE_URL` | **Sim** | — | String de conexão Postgres (`postgresql://user:pass@host:porta/db`). Sem ela o boot falha. |
| `DB_POOL_MAX` | Não | `20` | Máx. de conexões no pool. Baixo demais = gargalo; alto demais pode estourar o limite do servidor Postgres. |
| `DB_IDLE_TIMEOUT_MS` | Não | `30000` | Tempo até fechar conexão ociosa. |
| `DB_CONNECTION_TIMEOUT_MS` | Não | `5000` | Tempo máx. para abrir conexão antes de falhar. |
| `DB_STATEMENT_TIMEOUT_MS` | Não | `10000` | Tempo máx. de uma query. Mitiga **DoS por query lenta** / exaustão de conexões. |

## Redis (estado da conversa, throttler, sessões)

| Variável | Obrigatória | Default | Função e consequências |
|---|---|---|---|
| `REDIS_HOST` | Não | `127.0.0.1` | Host do Redis. |
| `REDIS_PORT` | Não | `6379` | Porta do Redis. |
| `REDIS_PASSWORD` | Não (dev) | vazio | Senha (`AUTH`). Sem ela, um Redis exposto fica aberto a quem alcança a porta — e ele guarda **sessões** (`secondaryStorage`), rate limit e, no chatbot, o estado das conversas. **Defina em produção.** |
| `REDIS_TLS` | Não | `false` | Liga TLS (`rediss://`). `false` em dev; **ligue em produção**. Redis gerenciado (Upstash/ElastiCache/Redis Cloud/Railway) normalmente **exige** TLS. |

## Under Pressure (circuit breaker de memória)

| Variável | Obrigatória | Default | Função e consequências |
|---|---|---|---|
| `PRESSURE_MAX_HEAP_BYTES` | Não | `500000000` | Limite de heap; acima dele o app passa a responder `503` (proteção de sobrecarga). Calibre ao limite de memória do container. |
| `PRESSURE_MAX_RSS_BYTES` | Não | `800000000` | Idem para RSS. |

## API RevGás

| Variável | Obrigatória | Default | Função e consequências |
|---|---|---|---|
| `REVGAS_API_URL` | Não (por enquanto) | vazio = não definida | URL base da API pública do ERP RevGás. Validada como URL quando preenchida. |
| `REVGAS_API_KEY` | Não (por enquanto) | vazio = não definida | API Key solicitada ao suporte da RevGás. **Fica só no servidor** (RNF02): nunca vai para o front, para o prompt da IA nem para logs. Vazar = qualquer um cria/consulta vendas no ERP da revenda. |

> Ambas viram obrigatórias quando o cliente `lib/revgas` for implementado.

## WhatsApp e LLM

A definir — o provedor de WhatsApp (Cloud API, Evolution ou Z-API) e o modelo de IA ainda não
foram escolhidos. As variáveis entram aqui quando forem.

## E-mail — Resend (standby)

Usadas só pelo `EmailService`, cujo único consumidor é a auth (standby). Ver
[email-service.md](../services/email-service.md).

| Variável | Obrigatória | Default | Função e consequências |
|---|---|---|---|
| `RESEND_API_KEY` | Não (na prática, sim em produção com a auth ligada) | vazio = não definida | Chave da API do Resend. Em `test` o envio é sempre log-only; em dev sem `EMAIL_DEV_REDIRECT` também. Em produção sem chave, emails de verificação/reset falham. |
| `EMAIL_FROM` | Não | `onboarding@resend.dev` | Remetente. Sem domínio verificado o Resend só permite `onboarding@resend.dev` (e só para o dono da conta). Em produção: `"Nome <no-reply@exemplo.com>"` com DNS verificado (SPF/DKIM/DMARC). |
| `EMAIL_DEV_REDIRECT` | Não (só dev) | vazio = não definida | Em dev, envia de verdade mas **redireciona todos** os emails para este endereço. Vazio em dev = log-only. Validada como email. Ignorada em produção (envia ao destinatário real). |

## Documentação (Swagger/Scalar)

| Variável | Obrigatória | Default | Função e consequências |
|---|---|---|---|
| `DOC_TOKEN` | Não | vazio | Protege `/openapi.json` e `/docs` (header `x-doc-token`). Vazio = doc aberta (sem proteção) em dev/test. Em **produção** a doc não é montada de qualquer forma. Gere com `openssl rand -hex 16`. |

---

## Variáveis do docker-compose (não validadas pelo app)

O `docker-compose.yml` usa estas para subir o container do Postgres local (`revgas-pg`; o Redis é `revgas-redis`). **Não** são lidas pelo
app (que usa só a `DATABASE_URL`); existem para conveniência de dev e têm default embutido
(`${VAR:-default}`). Mantenha-as **em sincronia** com a `DATABASE_URL`.

| Variável | Default | Função |
|---|---|---|
| `POSTGRES_USER` | `docker` | Usuário do Postgres do container. |
| `POSTGRES_PASSWORD` | `docker` | Senha do Postgres do container. **Troque** em qualquer ambiente compartilhado. |
| `POSTGRES_DB` | `revgas` | Nome do banco criado no container. |

---

## Validações de boot

Além dos tipos, o schema aplica refinamentos que **derrubam o boot** se violados:

- `BETTER_AUTH_SECRET` preenchida com < 32 chars → erro.
- `DATABASE_URL` / `BETTER_AUTH_URL` / `REVGAS_API_URL` / `EMAIL_DEV_REDIRECT` (se preenchidas) mal formadas → erro.
- **Em produção**, `CORS_ORIGIN` ausente → erro (`CORS_ORIGIN é obrigatório em produção`).
- **Em produção**, `CORS_ORIGIN` contendo `*` → erro (`CORS_ORIGIN não pode conter "*"`).

---

## Checklist de produção

- [ ] `NODE_ENV=production`
- [ ] Se a auth estiver ligada: `BETTER_AUTH_SECRET` forte (`openssl rand -base64 32`) via secrets, `BETTER_AUTH_URL` na URL pública (HTTPS), `RESEND_API_KEY` de produção e `EMAIL_FROM` de domínio verificado
- [ ] `CORS_ORIGIN` com as origens reais do front, **sem `*`**
- [ ] `TRUSTED_PROXY` conforme a topologia (IP/CIDR do proxy/LB; contagem de hops não é aceita)
- [ ] `DATABASE_URL` do banco gerenciado
- [ ] `REDIS_PASSWORD` definido e `REDIS_TLS=true` (se gerenciado)
- [ ] `REVGAS_API_URL` e `REVGAS_API_KEY` via secrets (nunca no repo nem no front)
- [ ] `DOC_TOKEN` definido (ou doc desativada)
- [ ] `PRESSURE_MAX_*` calibrados ao limite de memória do container

> Estas decisões de segurança também estão consolidadas em
> [security/SECURITY.md](../../security/SECURITY.md).
