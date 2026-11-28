-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- Latência por dia e volume/resultado de IA. Telemetria pode perder eventos.
SELECT date_trunc('day', occurred_at) AS dia_utc,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)
         FILTER (WHERE name = 'turn') AS turno_p50_ms,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_ms)
         FILTER (WHERE name = 'turn') AS turno_p90_ms,
       count(*) FILTER (WHERE name = 'ai_call') AS chamadas_ia,
       count(*) FILTER (WHERE name = 'ai_call' AND outcome = 'limited') AS chamadas_limitadas
FROM bot_events
WHERE occurred_at >= now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END)
  AND name IN ('turn', 'ai_call')
  AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
GROUP BY dia_utc
ORDER BY dia_utc;
