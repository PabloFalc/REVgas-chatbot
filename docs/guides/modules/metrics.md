# Métricas do bot

O módulo grava eventos em `bot_events` para acompanhar pedidos, dúvidas e falhas do fluxo. Cada evento gera um INSERT sem aguardar o banco. Rejeições e exceções síncronas geram um aviso fixo, sem dados do evento; a conversa continua com as mesmas respostas. Se o banco falhar, esses eventos se perdem. Não há fila, retry ou backfill.

## Schema e correlação

A tabela tem `id` bigint identity, `occurred_at` timestamptz, `name`, `cycle_id` UUID opcional, `prev_step`, `step`, `outcome`, `reason`, `duration_ms` e `amount`. As classificações são uniões fechadas em `metrics.types.ts`. Os índices cobrem data, nome com data e ciclo.

`cycle_id` é um UUID aleatório gerado para cada ciclo de pedido e mantido no estado do Redis. Estados antigos recebem um UUID quando avançam ou enviam lembrete. O identificador não deriva do telefone e não permite consultar um cliente. Eventos na rota humana podem ficar sem ciclo.

A tabela não recebe telefone, nome, CPF, endereço, mensagens, identificadores de cliente ou venda da RevGás, nem texto livre de erros. Não há JSON. Ainda existe risco de correlação por horário com outros registros: limite o acesso aos relatórios e ao banco.

## Catálogo

| Evento | Classificações e valores |
| --- | --- |
| `turn` | Etapa anterior, próxima etapa e duração desde a entrada da mensagem até o fim do envio; apenas rota bot |
| `reminder_sent` | Etapa do lembrete enviado |
| `sale` | `created`, `failed`, `rejected`; razão `direct`, `recovered`, tipo de erro RevGás ou `unexpected` |
| `handoff` | Status do handoff; `customer_request`, `sale_failed`, `emergency` |
| `handoff_offered` | `stuck` após três incompreensões ou `offense` após duas ofensas |
| `quantity_limit` | `max` ou `stock` |
| `emergency` | `agent_route` quando há emergência na rota humana |
| `rag` | `answered` ou `unknown`; `no_match`, `not_in_sources`, `rejected`, `unavailable`; duração em ms |
| `ai_call` | `allowed` ou `limited`; `interpret`, `read_name`, `address`, `question`; unidades do limite em `amount` |
| `order_status` | `found` ou `none` |
| `cpf` | `mismatch`, `blocked`, `blocked_hit`; tentativas em `amount` |

`SaleRejectedError` não carrega `kind`: recebe razão `unexpected` e outcome `rejected`. Um `blocked_hit` usa o limiar de três tentativas, pois o estado de bloqueio guarda apenas sua existência. `ai_call` mede unidades do limite local, sem tokens ou custo financeiro.

## Retenção

`METRICS_ENABLED` vale `true` por padrão; `false` desliga gravação e limpeza. `METRICS_RETENTION_DAYS` é um inteiro positivo, padrão 180. A limpeza remove eventos anteriores ao limite ao iniciar e a cada 24 horas. O timer não mantém o processo aberto e fica desligado em testes. Falha na limpeza gera aviso e será tentada na próxima execução.

## Metabase local

1. Aplique a migração com `pnpm db:migrate`.
2. Copie `docker/metabase.env.example` para `docker/metabase.env`. Defina a mesma senha local forte em `POSTGRES_PASSWORD` e `MB_DB_PASS`. Esse arquivo fica fora do Git.
3. Crie a credencial de consulta no Postgres do bot, usando `psql` e uma senha própria. O script deve ser executado uma vez; não é uma migração:

```sh
psql "$DATABASE_URL" -v pass='senha-local-de-consulta' -f docker/metabase/metrics-reader.sql
```

4. Rode `pnpm metabase:up` e abra http://localhost:3001. Crie a conta administrativa local. Adicione uma conexão PostgreSQL com host `postgres`, porta `5432`, banco `revgas`, usuário `metrics_reader` e a senha de consulta. Ajuste o nome do banco se seu ambiente usar outro.
5. Rode `pnpm metabase:stop` ao terminar. Os volumes preservam a configuração. Não remova containers ou volumes existentes.

A imagem OSS fica fixa em `metabase/metabase:v0.65.3.7`, a versão estável mais recente da série principal publicada até 09/11/2026. O [Docker Hub](https://hub.docker.com/r/metabase/metabase/tags?name=v0.65.3.7) informa publicação em 09/11/2026 às 21:26 UTC; `v0.65.4` foi publicada em 10/11. O perfil mantém o banco de configuração separado e desliga telemetria anônima. A interface só escuta em `127.0.0.1:3001`.

O usuário `metrics_reader` tem CONNECT, USAGE no schema e SELECT apenas em `bot_events`, limite de dez conexões e timeout de 10 segundos. Não use a credencial administrativa do bot no Metabase. Permissões públicas herdadas do PostgreSQL também devem ser consideradas ao instalar em outro ambiente.

## Cards SQL

As consultas estão em [`../metrics/sql/`](../metrics/sql/). Cole cada arquivo em uma pergunta SQL e configure `dias` como variável numérica obrigatória, padrão 30. Use o mesmo fuso horário da operação nas conexões e nos cards.

| Arquivo | Card |
| --- | --- |
| `funil.sql` | Ciclos iniciados, resumo, venda e conversão por dia |
| `abandono.sql` | Último turno com etapa, inativo há mais de 15 minutos, sem venda criada/rejeitada nem handoff; separado por lembrete |
| `vendas.sql` | Vendas por resultado e razão |
| `handoffs.sql` | Transferências e ofertas |
| `rag.sql` | Taxa de respostas desconhecidas por dia, total e por razão |
| `ia.sql` | Uso e bloqueios de IA por hora e finalidade |
| `latencia.sql` | p50 e p95 do turno por dia |
| `operacao.sql` | Limites de quantidade, status de pedido e CPF |

O funil agrupa pelo dia do primeiro evento do ciclo dentro do intervalo. Os cards consideram apenas eventos no período escolhido; ciclos cortados pela janela podem ficar incompletos. Recuperações de venda contam como eventos `sale created`; o funil deduplica por ciclo. Ofertas de handoff podem se repetir após o limiar.

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
