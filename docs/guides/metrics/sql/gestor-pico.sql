-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- Volume por hora UTC até a revenda aprovar o fuso operacional.
SELECT extract(hour FROM occurred_at AT TIME ZONE 'UTC')::int AS hora_utc,
       count(DISTINCT cycle_id) AS intencoes
FROM bot_events
WHERE name = 'purchase_started'
  AND occurred_at >= now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END)
  AND cycle_id IS NOT NULL
  AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
GROUP BY hora_utc
ORDER BY hora_utc;
