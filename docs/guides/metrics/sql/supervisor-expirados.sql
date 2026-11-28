-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- Expirações únicas por handoff_id e transferências por motivo; duração em segundos, só de handoff_expired.
-- handoff_expired não carrega motivo: usa o motivo do evento handoff do mesmo ciclo.
WITH ev AS (
  SELECT id, name, cycle_id, handoff_id, reason, duration_ms, occurred_at
  FROM bot_events
  WHERE name IN ('handoff_expired', 'handoff')
    AND occurred_at >= now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END)
    AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
), expirados AS (
  SELECT DISTINCT ON (handoff_id) handoff_id, cycle_id, reason, duration_ms
  FROM ev
  WHERE name = 'handoff_expired' AND handoff_id IS NOT NULL
  ORDER BY handoff_id, occurred_at, id
), linhas AS (
  SELECT 'transferido' AS tipo, reason AS motivo, NULL::bigint AS duration_ms
  FROM ev WHERE name = 'handoff'
  UNION ALL
  SELECT 'expirado', coalesce(x.reason, (
           SELECT t.reason FROM ev t
           WHERE t.name = 'handoff' AND t.cycle_id = x.cycle_id
           ORDER BY t.occurred_at, t.id LIMIT 1)), x.duration_ms
  FROM expirados x
)
SELECT coalesce(motivo, 'sem_motivo') AS motivo,
       count(*) FILTER (WHERE tipo = 'expirado') AS expirados,
       count(*) FILTER (WHERE tipo = 'transferido') AS pedidos_transferidos,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)
         FILTER (WHERE tipo = 'expirado') / 1000.0 AS duracao_expiracao_p50_seg
FROM linhas
GROUP BY coalesce(motivo, 'sem_motivo')
ORDER BY expirados DESC, motivo;
