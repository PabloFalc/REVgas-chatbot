SELECT occurred_at::date AS dia,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
FROM bot_events
WHERE occurred_at >= now() - make_interval(days => {{dias}}) AND name = 'turn'
GROUP BY dia ORDER BY dia;
