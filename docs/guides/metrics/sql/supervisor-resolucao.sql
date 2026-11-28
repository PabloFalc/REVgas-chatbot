-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- Categoria final do ciclo. Exige evento conversation_resolved novo; sem ele o ciclo é pendente.
-- O percentual considera só ciclos encerrados; pendente não recebe percentual.
WITH starts AS (
  SELECT DISTINCT cycle_id FROM bot_events
  WHERE name = 'purchase_started' AND cycle_id IS NOT NULL
    AND occurred_at >= now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END)
    AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
), handoffs AS (
  SELECT DISTINCT cycle_id FROM bot_events
  WHERE name IN ('handoff_assumed', 'handoff_resolved') AND cycle_id IS NOT NULL
    AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
), outcomes AS (
  SELECT DISTINCT cycle_id FROM sale_attempts
  WHERE status = 'registered' AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
), classified AS (
  SELECT s.cycle_id,
    CASE WHEN r.resolved_cycle_id IS NULL THEN 'pendente'
         WHEN h.cycle_id IS NOT NULL THEN 'mista'
         WHEN o.cycle_id IS NOT NULL THEN 'automatica'
         WHEN r.outcome = 'abandoned' THEN 'abandonada'
         ELSE 'por_humano' END AS categoria
  FROM starts s
  LEFT JOIN LATERAL (
    SELECT e.cycle_id AS resolved_cycle_id, e.outcome FROM bot_events e WHERE e.cycle_id = s.cycle_id
      AND e.name = 'conversation_resolved'
      AND (e.is_simulated = false OR {{incluir_simulados}} = 'sim')
    ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1
  ) r ON true
  LEFT JOIN handoffs h USING (cycle_id)
  LEFT JOIN outcomes o USING (cycle_id)
)
SELECT categoria, count(*) AS ciclos,
       CASE WHEN categoria = 'pendente' THEN NULL
            ELSE round(100.0 * count(*)
              / nullif(sum(count(*)) FILTER (WHERE categoria <> 'pendente') OVER (), 0), 1) END AS percentual
FROM classified GROUP BY categoria ORDER BY categoria;
