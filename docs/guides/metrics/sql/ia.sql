SELECT date_trunc('hour', occurred_at) AS hora, reason,
  count(*) FILTER (WHERE outcome = 'allowed') AS permitidas,
  count(*) FILTER (WHERE outcome = 'limited') AS bloqueadas,
  sum(amount) FILTER (WHERE outcome = 'allowed') AS unidades_consumidas
FROM bot_events
WHERE occurred_at >= now() - make_interval(days => {{dias}}) AND name = 'ai_call'
GROUP BY hora, reason ORDER BY hora, reason;
