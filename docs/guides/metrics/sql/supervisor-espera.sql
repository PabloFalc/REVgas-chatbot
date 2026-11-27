-- SLI de meta ainda não aparece: falta aprovação do limite pela revenda.
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) / 1000.0 AS espera_p50_seg,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_ms) / 1000.0 AS espera_p90_seg,
       count(*) AS handoffs_assumidos
FROM bot_events
WHERE name = 'handoff_assumed'
  AND occurred_at >= now() - make_interval(days => {{dias}})
  AND duration_ms IS NOT NULL
  AND is_simulated = false;
