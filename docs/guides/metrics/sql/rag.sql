SELECT occurred_at::date AS dia, CASE WHEN grouping(reason) = 1 THEN 'total' ELSE coalesce(reason, 'answered') END AS motivo,
  count(*) FILTER (WHERE outcome = 'unknown') AS desconhecidas,
  count(*) AS chamadas,
  round(100.0 * count(*) FILTER (WHERE outcome = 'unknown') / nullif(count(*), 0), 2) AS taxa_nao_sei_percentual
FROM bot_events
WHERE occurred_at >= now() - make_interval(days => {{dias}}) AND name = 'rag'
GROUP BY dia, ROLLUP(reason) ORDER BY dia, motivo;
