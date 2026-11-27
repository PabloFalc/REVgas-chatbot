# Métricas do bot

O módulo grava eventos em `bot_events` para acompanhar pedidos, dúvidas e falhas do fluxo. Cada evento gera um INSERT sem aguardar o banco. Rejeições e exceções síncronas geram um aviso fixo, sem dados do evento; a conversa continua com as mesmas respostas. Se o banco falhar, esses eventos se perdem. Não há fila, retry ou backfill.

## Schema e correlação

A tabela tem `id` bigint identity, `occurred_at` timestamptz, `name`, `cycle_id` UUID opcional, `handoff_id` UUID opcional, `prev_step`, `step`, `outcome`, `reason`, `duration_ms` e `amount`. As classificações são uniões fechadas em `metrics.types.ts`. Os índices cobrem data, nome com data e ciclo.

`cycle_id` é um UUID aleatório gerado para cada ciclo de pedido e mantido no estado do Redis. Estados antigos recebem um UUID quando avançam ou enviam lembrete. O identificador não deriva do telefone e não permite consultar um cliente. Eventos na rota humana podem ficar sem ciclo.

A tabela não recebe telefone, nome, CPF, endereço, mensagens, identificadores de cliente ou venda da RevGás, nem texto livre de erros. Não há JSON. Ainda existe risco de correlação por horário com outros registros: limite o acesso aos relatórios e ao banco.

## Catálogo

| Evento | Classificações e valores |
| --- | --- |
| `turn` | Etapa anterior, próxima etapa e duração desde a entrada da mensagem até o fim do envio; apenas rota bot |
| `reminder_sent` | Etapa do lembrete enviado |
| `sale` | `created`, `failed`, `rejected`; razão `direct`, `recovered`, tipo de erro RevGás ou `unexpected` |
| `order_cancelled` | Pedido cancelado pelo cliente sem venda criada |
| `handoff` | Status do handoff; `customer_request`, `sale_failed`, `emergency` |
| `handoff_assumed`, `handoff_resolved`, `handoff_expired` | `handoff_id` aleatório do ciclo humano e duração em ms: fila até a primeira mensagem humana, atendimento até a resolução, ou tempo desde o pedido até a expiração. Sem telefone, conversa Chatwoot nem mensagem |
| `handoff_offered` | `stuck` após três incompreensões ou `offense` após duas ofensas |
| `quantity_limit` | `max` ou `stock` |
| `emergency` | `agent_route` quando há emergência na rota humana |
| `rag` | `answered` ou `unknown`; `no_match`, `not_in_sources`, `rejected`, `unavailable`; duração em ms |
| `ai_call` | `allowed` ou `limited`; `interpret`, `read_name`, `address`, `question`; unidades do limite em `amount` |
| `order_status` | `found` ou `none` |
| `cpf` | `mismatch`, `blocked`, `blocked_hit`; tentativas em `amount` |
| `identity_check` | `verified`, `failed` ou `owner_changed` na confirmação do CPF completo; sem id de cliente nem CPF |
| `sale_outcome_unknown` | Venda de resultado incerto: `timeout`, `server_error`, `invalid_response` ou `other`. Também sai com `other` para cada tentativa `pending` que a varredura marca como `uncertain` 60 s depois do boot |

`SaleRejectedError` não carrega `kind`: recebe razão `unexpected` e outcome `rejected`. Um `blocked_hit` usa o limiar de três tentativas, pois o estado de bloqueio guarda apenas sua existência. `ai_call` mede unidades do limite local, sem tokens ou custo financeiro.

## Retenção

`METRICS_ENABLED` vale `true` por padrão; `false` desliga gravação e limpeza. `METRICS_RETENTION_DAYS` é um inteiro positivo, padrão 180. A limpeza remove eventos anteriores ao limite ao iniciar e a cada 24 horas. O timer não mantém o processo aberto e fica desligado em testes. Falha na limpeza gera aviso e será tentada na próxima execução.

## Metabase local

1. Aplique a migração com `pnpm db:migrate`.
2. Copie `docker/metabase.env.example` para `docker/metabase.env`. O exemplo usa o mesmo placeholder em `POSTGRES_PASSWORD` e `MB_DB_PASS`; substitua os dois por senhas locais fortes (podem ser iguais). Esse arquivo fica fora do Git.
3. Crie a credencial de consulta no Postgres do bot, usando `psql` e uma senha própria. O script deve ser executado uma vez; não é uma migração. Ele usa a variável `DBNAME` no `GRANT CONNECT`, por isso ela é obrigatória:

```sh
psql "$DATABASE_URL" -v DBNAME=revgas -v pass='senha-local-de-consulta' -f docker/metabase/metrics-reader.sql
```

Se o host não tem `psql`, rode o mesmo script dentro do container `revgas-pg`. A senha de consulta é nova e deve ser diferente das senhas de `docker/metabase.env`. O script cria o usuário com `CONNECTION LIMIT 10`, o mesmo limite descrito abaixo:

```sh
docker exec -i revgas-pg psql -U docker -d revgas -v DBNAME=revgas -v pass='senha-local-de-consulta' -f - < docker/metabase/metrics-reader.sql
```

4. Rode `pnpm metabase:up` e espere a interface responder em http://localhost:3001.
5. Copie `docker/metabase.provision.env.example` para `docker/metabase.provision.env` e preencha e-mail e senha da conta administrativa (a primeira execução cria essa conta) e a senha do `metrics_reader` criada no passo 3. Esse arquivo também fica fora do Git. Ele é separado de `docker/metabase.env` de propósito: o compose injeta `docker/metabase.env` nos containers, e as credenciais do provisionamento não devem ir parar no ambiente do Metabase.
6. Rode `pnpm metabase:provision`. O comando espera o `/api/health` por até 3 minutos e deixa a instância assim: administrador criado se ainda não existir, fuso dos relatórios `America/Sao_Paulo`, telemetria anônima desligada, conexão PostgreSQL "RevGás (leitura)" com o usuário `metrics_reader`, coleções Gestor e Supervisor e as quatro perguntas P0 com as variáveis `dias` e `incluir_simulados`. O SQL de cada pergunta é lido de `docs/guides/metrics/sql/` na hora da execução.
7. Rode `pnpm metabase:stop` ao terminar. Os volumes preservam a configuração. Não remova containers ou volumes existentes.

O comando pode ser repetido. Cada linha da saída diz se o item foi criado, atualizado ou ficou sem mudança, e uma segunda execução seguida deve terminar com zero criados e zero atualizados. O que alguém editar pela interface nas perguntas (SQL, variáveis, coleção, conexão) volta ao definido no repositório na próxima execução; o tipo de gráfico e o restante da visualização não são tocados.

A API do Metabase não devolve a senha da conexão, então o comando não consegue saber se ela mudou. Depois de trocar a senha do `metrics_reader`, atualize `METABASE_READER_PASSWORD` e rode `pnpm metabase:provision --atualizar-senha`.

Variáveis lidas pelo comando (do ambiente do processo ou de `docker/metabase.provision.env`; o ambiente vence o arquivo):

| Variável | Uso |
| --- | --- |
| `METABASE_URL` | Endereço do Metabase. Padrão `http://127.0.0.1:3001` |
| `METABASE_ADMIN_EMAIL`, `METABASE_ADMIN_PASSWORD` | Conta administrativa. Criada se a instância ainda não tem usuário; usadas para entrar nas execuções seguintes. Dispensáveis se `METABASE_API_KEY` estiver definida e a instância já tiver administrador |
| `METABASE_API_KEY` | Chave de API do Metabase (grupo Administrators). Opcional; quando existe, vale no lugar de e-mail e senha |
| `METABASE_READER_HOST`, `METABASE_READER_PORT`, `METABASE_READER_NAME` | Postgres do bot visto de dentro do container do Metabase. Padrões `postgres`, `5432`, `revgas` |
| `METABASE_READER_USER` | Padrão `metrics_reader` |
| `METABASE_READER_PASSWORD` | Obrigatória. Senha do `metrics_reader` |

Se faltar variável obrigatória ou o Metabase não responder, o comando termina com código 1 e uma mensagem que cita o nome da variável ou o endereço, sem imprimir valores secretos.

A imagem OSS fica fixa em `metabase/metabase:v0.65.3.7`, a versão estável mais recente da série principal publicada até 09/11/2026. O [Docker Hub](https://hub.docker.com/r/metabase/metabase/tags?name=v0.65.3.7) informa publicação em 09/11/2026 às 21:26 UTC; `v0.65.4` foi publicada em 10/11. O perfil mantém o banco de configuração separado e desliga telemetria anônima. A interface só escuta em `127.0.0.1:3001`.

O usuário `metrics_reader` tem CONNECT, USAGE no schema, SELECT em `bot_events` e SELECT só nas colunas analíticas de `sale_attempts` (`customer_id` e `erp_sale_id` ficam de fora), limite de dez conexões e timeout de 10 segundos. Não use a credencial administrativa do bot no Metabase. Permissões públicas herdadas do PostgreSQL também devem ser consideradas ao instalar em outro ambiente. Se o usuário já existe, rode apenas a última linha do script (o `GRANT` de `sale_attempts`) em vez do arquivo inteiro.

## Deploy

Sequência para um servidor com o Metabase do compose. Os comandos rodam a partir de um checkout do repositório, porque o provisionamento lê os SQLs de `docs/guides/metrics/sql/`.

1. Defina `docker/metabase.env` (senhas do banco de configuração do Metabase) e `docker/metabase.provision.env` (ou exporte as variáveis `METABASE_*` do pipeline) com os valores do servidor.
2. Aplique as migrações no Postgres do bot e crie o papel de leitura com `docker/metabase/metrics-reader.sql`, como no passo 3 acima. Em instalação já existente, o papel já existe: só falta aplicar a última linha do script (o `GRANT` de colunas em `sale_attempts`).
3. Suba o Metabase com `pnpm metabase:up`.
4. Rode `pnpm metabase:provision`. Em deploys seguintes basta repetir esse passo; ele só altera o que divergir.
5. Confira na saída a linha final (`Concluído: ...`) e abra uma das perguntas na interface.

Em servidor, `METABASE_URL` deve apontar para o endereço que o processo de deploy enxerga, e `METABASE_READER_HOST` para o endereço do Postgres do bot visto de dentro do container do Metabase.

## Cards SQL

As consultas estão em [`../metrics/sql/`](../metrics/sql/). Use o mesmo fuso horário da operação nas conexões e nos cards. Os quatro cards P0 (`gestor-*` e `supervisor-espera`) seguem as regras da subseção abaixo e são criados por `pnpm metabase:provision`.

| Arquivo | Card |
| --- | --- |
| `funil.sql` | Ciclos iniciados, resumo, venda e conversão por dia |
| `abandono.sql` | Último turno com etapa e fase (cadastro ou pedido), inativo há mais de 15 minutos, sem venda criada/rejeitada, cancelamento nem handoff; com ou sem lembrete |
| `vendas.sql` | Vendas e cancelamentos por resultado e razão |
| `handoffs.sql` | Transferências e ofertas |
| `rag.sql` | Taxa de respostas desconhecidas por dia, total e por razão |
| `ia.sql` | Uso e bloqueios de IA por hora e finalidade |
| `latencia.sql` | p50 e p95 do turno por dia |
| `operacao.sql` | Limites de quantidade, status de pedido e CPF |
| `gestor-vendas.sql` | Pedidos registrados, valor e ticket médio em BRL e tentativas incertas, a partir de `sale_attempts` |
| `gestor-conversao.sql` | Conversão por coorte de `purchase_started`: madura (mais de 24 h) e sobre todas as intenções |
| `gestor-abandono.sql` | Ciclos com `purchase_started` sem resultado terminal há mais de 24 h, por última etapa |
| `supervisor-espera.sql` | Mediana e p90 da espera, em segundos, do pedido de handoff até a assunção, sem percentual de meta |

### Cards P0 do painel

Os quatro cards vão em duas coleções, criadas pelo provisionamento: Gestor (`gestor-vendas`, `gestor-conversao`, `gestor-abandono`) e Supervisor (`supervisor-espera`). Cada um usa duas variáveis, com os mesmos nomes nos quatro:

- `dias`: numérica, obrigatória, padrão 30. O próprio SQL recusa valores fora de 1 a 365 com erro do Postgres (`dias deve estar entre 1 e 365, recebido N`), sem ajustar o valor. O Metabase não impede 0 ou 10000 na variável, então a trava fica no SQL.
- `incluir_simulados`: texto, obrigatória, padrão `nao`, com lista de valores `nao` e `sim`. Com `nao` as linhas simuladas ficam de fora. Com `sim` entram também as simuladas, nas duas tabelas. Qualquer outro valor se comporta como `nao`.

A espera do supervisor mostra mediana, p90 e contagem. O percentual de meta fica de fora até a revenda aprovar o limite.

Limitação conhecida: o abandono depende do evento `conversation_resolved`, que ainda não tem produtor. Por isso um ciclo com `handoff_resolved` e sem venda aparece como abandono com etapa `unknown`.

A fonte canônica dos quatro SQLs é o repositório de planejamento (`docs/metricas/sql/`). A cópia em `docs/guides/metrics/sql/` existe para o teste E2E e deve ficar idêntica byte a byte (`cmp`).

O teste `tests/metrics/bot-events.e2e.spec.ts` cobre os números sobre uma fixture sintética, a recusa de `dias` fora do intervalo (parâmetro vinculado e número colado no texto), o controle de simulados, a ausência de colunas de identificação nos resultados e no texto dos SQLs, e o papel restrito. Para o papel, ele cria um papel temporário com os mesmos `GRANT` de `docker/metabase/metrics-reader.sql` e confere que os quatro cards executam, que `customer_id`, `erp_sale_id` e `SELECT *` em `sale_attempts` são negados e que nenhuma outra tabela do schema `public` é legível. Tudo termina em rollback. Esse teste não substitui a conferência manual no Metabase: variáveis, valores padrão, coleções e permissões de quem vê os cards precisam ser verificados na instância real.

O funil agrupa pelo dia do primeiro evento do ciclo dentro do intervalo. Os cards consideram apenas eventos no período escolhido; ciclos cortados pela janela podem ficar incompletos. Recuperações de venda contam como eventos `sale created`; o funil deduplica por ciclo. Ofertas de handoff podem se repetir após o limiar.

Cada ciclo começa em uma nova conversa, depois que a anterior terminou. Por isso há mais ciclos do que clientes, incluindo ciclos só com saudação. Leia a conversão como ciclos que chegaram a uma etapa, não como pessoas. Cancelamentos (`order_cancelled`) são um desfecho separado e não entram no abandono.

O card de abandono só mostra ciclos parados há mais de 15 minutos, o mesmo TTL de 900 s do estado do pedido. Logo após um teste, ele fica vazio.

Com poucos dias de dados, use eixo X ordinal nos cards de funil e de latência. Um eixo de tempo espalha poucos pontos e deixa o gráfico quase vazio.

## Chatwoot Reports

Use os Reports do Chatwoot para volume da caixa, fila, atendimento humano e tempos registrados pelo Chatwoot. As métricas do fluxo, venda e RAG ficam no Metabase; não há importação dos dados do Chatwoot.

A "primeira resposta" do Chatwoot não reflete o tempo de resposta no WhatsApp. O espelhamento é posterior ao envio e a recepção pelo WhatsApp não é medida por esse relatório. `turn.duration_ms` mede o processamento até o envio pelo gateway, sem comprovar entrega ao aparelho.

## Verificação

```sh
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
```

Os e2e exigem Postgres e Redis locais. `tests/metrics/bot-events.e2e.spec.ts` acompanha o webhook até uma venda fake, consulta apenas os ciclos do teste e compara as mensagens com o INSERT rejeitado.
