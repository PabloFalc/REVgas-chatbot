-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- Derivada de ia.sql: chamadas de IA por hora e finalidade, com permitidas e bloqueadas.
SELECT date_trunc('hour', occurred_at) AS hora, coalesce(reason, 'sem_motivo') AS reason,
  count(*) AS chamadas,
  count(*) FILTER (WHERE outcome = 'allowed') AS permitidas,
  count(*) FILTER (WHERE outcome = 'limited') AS bloqueadas,
  sum(amount) FILTER (WHERE outcome = 'allowed') AS unidades_consumidas
FROM bot_events
WHERE occurred_at >= now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END)
  AND name = 'ai_call' AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
GROUP BY hora, coalesce(reason, 'sem_motivo') ORDER BY hora, reason;
