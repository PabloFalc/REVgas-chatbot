# Deploy em produção (Dokploy)

O deploy é um compose do tipo raw no Dokploy: o servidor recebe só o texto de `docker/compose.prod.yaml`
e um bloco de variáveis. Nenhum arquivo do repositório vai para lá. Os scripts rodam na máquina de
quem faz o deploy, em `scripts/deploy/`, e precisam só do Node 24.

## O que sobe

| Serviço | Função |
| --- | --- |
| `postgres`, `redis` | Banco (pgvector) e Redis do bot, Redis com senha |
| `bot` | API NestJS na porta 3100. Aplica as migrações ao iniciar (`RUN_MIGRATIONS=true`) |
| `kb-ingest` | Uma vez por deploy, depois do bot saudável: ingere `knowledge/base`. É incremental, então repetir não custa |
| `metrics-reader-setup` | Uma vez por deploy: cria ou atualiza a role `metrics_reader` com os mesmos grants de `docker/metabase/metrics-reader.sql` |
| `chatwoot-postgres`, `chatwoot-redis` | Bancos do Chatwoot |
| `chatwoot-setup` | Uma vez por deploy: `db:chatwoot_prepare` e `docker/chatwoot/setup.rb` |
| `chatwoot-rails`, `chatwoot-sidekiq` | Só iniciam depois que o `chatwoot-setup` termina com sucesso |
| `metabase-postgres`, `metabase` | Metabase com banco próprio |

Ordem real: bancos, bot, `chatwoot-setup`, Rails e Sidekiq, em paralelo com `kb-ingest`,
`metrics-reader-setup` e Metabase. Os serviços de uma execução (`restart: "no"`) são idempotentes. Se
`kb-ingest` falhar (chave de embedding inválida, por exemplo), os outros continuam de pé.

Limites de memória somam cerca de 6 GB no pior caso (bot 768 MB, Chatwoot Rails e Sidekiq 1 GB cada,
Metabase 1,5 GB, bancos e Redis o restante). Os serviços de uma execução somam mais 1 a 1,5 GB
durante o deploy.

## Decisões de rede

- Bot para Chatwoot pela rede interna (`http://chatwoot-rails:3000`): não depende de DNS público nem
  do Traefik, e a chamada não sai do servidor.
- Chatwoot para bot pela URL pública (`https://revgas.felipeduan.com/webhooks/chatwoot`), sem
  `SAFE_FETCH_ALLOW_PRIVATE_NETWORK`.
- `TRUSTED_PROXY` usa os blocos privados (10/8, 172.16/12, 192.168/16): o único par que fala com o bot
  é o Traefik, dentro da rede do Docker. Se o IP real de clientes aparecer errado no log, troque pelo
  CIDR da rede `dokploy-network`.
- `CORS_ORIGIN` é o próprio domínio do bot. Webhooks não usam CORS.

## Gerar o env

Prepare um arquivo de texto local com as credenciais externas, uma por linha no formato `CHAVE=valor`
(pode ter outro texto misturado). Fica fora do repositório. As chaves esperadas são as marcadas como
ORIGEM em `docker/prod.env.example`.

```bash
node scripts/deploy/render-prod-env.mjs ORIGENS.txt --out prod.env
```

O script gera as senhas e tokens (GERADA), preenche as FIXAS, grava `prod.env` com permissão 600 e
imprime só o nome de cada chave e se ficou preenchida. Falha listando as obrigatórias vazias. Rodar de
novo reaproveita as GERADAS que já estão em `prod.env`, então as senhas de banco não mudam. Para
sobrescrever um valor: `--set CHAVE=valor`. Sem `EMBEDDING_API_KEY`, ele usa a chave do LLM e avisa.

`prod.env` nunca vai para o Git. O `WHATSAPP_VERIFY_TOKEN` gerado está nesse arquivo: é o texto que você
informa na tela do webhook da Meta.

## Enviar ao Dokploy

Crie o compose no Dokploy como fonte raw (uma vez) e anote o `composeId`.

```bash
DOKPLOY_URL=https://painel.exemplo.com DOKPLOY_API_KEY=... \
  node scripts/deploy/dokploy-push.mjs <composeId> docker/compose.prod.yaml prod.env
```

O script atualiza o compose e o env pela API (`compose.update`), mostra só o status HTTP e não dispara o
deploy. Chaves do env que o compose não usa (as de provisionamento do Metabase) não são enviadas.
Depois, no painel, crie os domínios (HTTPS) e faça o deploy:

| Domínio | Serviço | Porta |
| --- | --- | --- |
| revgas.felipeduan.com | `bot` | 3100 |
| chatwoot.revgas.felipeduan.com | `chatwoot-rails` | 3000 |
| metabase.revgas.felipeduan.com | `metabase` | 3000 |

O servidor precisa de Docker Compose recente (2.23.1 ou mais), por causa de `configs` com `content`.

## Provisionar o Metabase

Depois do deploy, com o Metabase respondendo. Roda na máquina local, dentro do repositório (os SQLs
vêm de `docs/guides/metrics/sql/`). Em bash ou zsh:

```bash
set -a; source prod.env; set +a
METABASE_URL="$METABASE_PUBLIC_URL" \
METABASE_READER_HOST=postgres \
METABASE_READER_NAME="$POSTGRES_DB" \
METABASE_READER_PASSWORD="$METRICS_READER_PASSWORD" \
node docker/metabase/provision.mjs
```

`METABASE_ADMIN_EMAIL` e `METABASE_ADMIN_PASSWORD` vêm do `prod.env`. Em um Metabase novo, o comando
cria o administrador pelo setup inicial. Pode ser repetido.

## Validar

1. `https://revgas.felipeduan.com/health` responde 200 com `status` `ok` (ou `degraded`, que vem da
   checagem de memória do app e não derruba o container).
2. Na Meta, em WhatsApp, Configuração, Webhook: URL `https://revgas.felipeduan.com/webhooks/whatsapp` e
   o `WHATSAPP_VERIFY_TOKEN` do `prod.env`. A verificação deve passar. Assine o campo `messages`.
3. Entre em `https://chatwoot.revgas.felipeduan.com` com `CHATWOOT_ADMIN_EMAIL` e
   `CHATWOOT_ADMIN_PASSWORD`. A caixa "WhatsApp Bot" deve ter o webhook para o bot.
4. Entre em `https://metabase.revgas.felipeduan.com` com o e-mail e a senha de administrador e abra os
   dashboards Gestor, Supervisor e Técnico.
5. Nos logs de `chatwoot-setup` aparecem só `OUT:CHATWOOT_ACCOUNT_ID` e `OUT:CHATWOOT_INBOX_ID`, que devem
   ser os valores de `CHATWOOT_ACCOUNT_ID` e `CHATWOOT_INBOX_ID` (1 e 1). Se forem outros, o setup
   falha de propósito.

## Rollback

Troque `BOT_IMAGE_TAG` pela tag anterior no `prod.env`, envie de novo com `dokploy-push` e faça o
redeploy. Migrações já aplicadas não voltam sozinhas: se a versão nova trouxe uma migração
incompatível, o rollback da imagem precisa de uma correção de banco à parte.

## Cuidados

- Trocar uma senha de banco no env não troca a senha dentro de um volume já criado (Postgres só lê a
  variável na primeira vez). Para rotacionar, altere também dentro do banco.
- `METABASE_ENCRYPTION_KEY` protege as credenciais guardadas no Metabase. Perdida, elas não são mais
  legíveis.
- O e-mail de administrador do Chatwoot é só um login: não há SMTP configurado, então recuperação de
  senha por e-mail não funciona.

## O que este deploy não cobre

- Backup e restauração dos volumes (Postgres do bot, Chatwoot, Metabase). Nada é copiado
  automaticamente.
- Monitoramento e alertas.
- Atualização de versão do Chatwoot e do Metabase (tags fixas no compose).
- Criptografia de campos do Chatwoot (`ACTIVE_RECORD_ENCRYPTION_*`), desligada.
- Teste com os serviços reais (WhatsApp, RevGás, LLM). O fluxo foi exercitado só com esses serviços
  em modo fake.
