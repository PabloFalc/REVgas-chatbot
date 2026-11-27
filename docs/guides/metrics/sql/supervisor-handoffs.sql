-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- Derivada de handoffs.sql: transferências e ofertas por motivo.
SELECT coalesce(reason, 'sem_motivo') AS motivo, name AS tipo, count(*) AS eventos
FROM bot_events
WHERE occurred_at >= now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END)
  AND name IN ('handoff', 'handoff_offered') AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
GROUP BY coalesce(reason, 'sem_motivo'), name ORDER BY eventos DESC;
