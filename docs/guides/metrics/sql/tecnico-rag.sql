-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- Derivada de rag.sql, sem a linha de total do ROLLUP: chamadas ao RAG por dia e motivo.
SELECT occurred_at::date AS dia, coalesce(reason, 'answered') AS motivo,
  count(*) FILTER (WHERE outcome = 'unknown') AS desconhecidas,
  count(*) AS chamadas,
  round(100.0 * count(*) FILTER (WHERE outcome = 'unknown') / nullif(count(*), 0), 2) AS taxa_nao_sei_percentual
FROM bot_events
WHERE occurred_at >= now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END)
  AND name = 'rag' AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
GROUP BY dia, coalesce(reason, 'answered') ORDER BY dia, motivo;
