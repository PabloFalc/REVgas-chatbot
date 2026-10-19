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
  `STRICT_AUTH_THROTTLE` (10/min, bloqueio 5min); `/health` com `HEALTH_THROTTLE` (120/min).

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

## Planejado (chatbot)

Itens que entram junto com os módulos do chatbot (ver [specs.md](../project/specs.md) e
[requisitos.md](../project/requisitos.md)):

- **LGPD — mascaramento nos logs:** CPF, telefone e endereço dos clientes mascarados em todo log
  (chamadas à API RevGás, handoffs, erros). Hoje a redaction do Pino cobre só segredos e `email`.
- **Cliente `lib/revgas`:** API Key injetada só no header da chamada server-side; retry com
  backoff apenas em 5xx/timeout e com idempotência para não duplicar vendas.
- **Webhook do WhatsApp:** validar a origem/assinatura do provedor escolhido antes de processar.
- **IA:** o prompt nunca recebe a API Key nem dados de outros clientes; saída validada com Zod.

## Extensões com impacto de segurança

- **Login social (OAuth):** não está no escopo. Se for adicionado, as colunas
  `access_token`/`refresh_token`/`id_token` em `accounts` são gravadas em **texto plano** —
  **ative a criptografia de tokens do Better Auth** ao habilitar OAuth.

## Itens em aberto

- **Performance** (não-segurança): compressão brotli em respostas pequenas (PERF-05) — avaliar
  priorizar `gzip` no dinâmico / subir o `threshold`. **Medir antes de mudar.**
