-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- SLI de meta ainda não aparece: falta aprovação do limite pela revenda.
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) / 1000.0 AS espera_p50_seg,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_ms) / 1000.0 AS espera_p90_seg,
       count(*) AS handoffs_assumidos
FROM bot_events
WHERE name = 'handoff_assumed'
  AND occurred_at >= now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END)
  AND duration_ms IS NOT NULL
  AND (is_simulated = false OR {{incluir_simulados}} = 'sim');
