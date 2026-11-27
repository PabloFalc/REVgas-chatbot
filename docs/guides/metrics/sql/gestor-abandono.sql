-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- Abandono operacional por coorte. Eventos terminais posteriores ao início
-- da janela continuam sendo considerados para não marcar ciclo resolvido como abandono.
WITH starts AS (
  SELECT cycle_id, min(occurred_at) AS started_at
  FROM bot_events
  WHERE name = 'purchase_started'
    AND occurred_at >= now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END)
    AND occurred_at <= now()
    AND cycle_id IS NOT NULL AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
  GROUP BY cycle_id
), last_event AS (
  SELECT DISTINCT ON (cycle_id) cycle_id, name, step, occurred_at
  FROM bot_events
  WHERE cycle_id IN (SELECT cycle_id FROM starts)
    AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
  ORDER BY cycle_id, occurred_at DESC
), terminal AS (
  SELECT cycle_id FROM sale_attempts
  WHERE status IN ('registered', 'rejected', 'uncertain', 'failed')
    AND cycle_id IN (SELECT cycle_id FROM starts)
    AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
  UNION
  SELECT cycle_id FROM bot_events
  WHERE name IN ('conversation_resolved', 'order_cancelled', 'sale_outcome_unknown')
    AND cycle_id IN (SELECT cycle_id FROM starts)
    AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
)
SELECT coalesce(l.step, 'unknown') AS ultima_etapa,
       count(*) AS ciclos_abandonados
FROM starts s
JOIN last_event l USING (cycle_id)
LEFT JOIN terminal t USING (cycle_id)
WHERE t.cycle_id IS NULL
  AND l.occurred_at < now() - interval '24 hours'
GROUP BY coalesce(l.step, 'unknown')
ORDER BY ciclos_abandonados DESC;
