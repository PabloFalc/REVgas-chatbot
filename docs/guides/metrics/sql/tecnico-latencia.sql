-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- Derivada de latencia.sql: p50 e p95 da duração do turno, em milissegundos, por dia.
SELECT occurred_at::date AS dia,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
FROM bot_events
WHERE occurred_at >= now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END)
  AND name = 'turn' AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
GROUP BY dia ORDER BY dia;
