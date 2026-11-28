-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- Segmento categórico sem exportar identificador de cliente.
-- Pedidos de segmento desconhecido ficam fora do denominador da recompra.
SELECT
  count(*) FILTER (WHERE customer_segment = 'recurring') AS pedidos_recorrentes,
  count(*) FILTER (WHERE customer_segment = 'new') AS pedidos_novos,
  count(*) FILTER (WHERE customer_segment = 'unknown' OR customer_segment IS NULL) AS pedidos_sem_segmento,
  round(100.0 * count(*) FILTER (WHERE customer_segment = 'recurring')
    / nullif(count(*) FILTER (WHERE customer_segment IN ('new', 'recurring')), 0), 1) AS recompra_pct
FROM sale_attempts
WHERE status = 'registered'
  AND created_at >= now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END)
  AND (is_simulated = false OR {{incluir_simulados}} = 'sim');
