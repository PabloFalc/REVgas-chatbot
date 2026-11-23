SELECT CASE WHEN name = 'order_cancelled' THEN 'cancelled' ELSE outcome END AS resultado,
  reason, count(*) AS eventos
FROM bot_events
WHERE occurred_at >= now() - make_interval(days => {{dias}}) AND name IN ('sale', 'order_cancelled')
GROUP BY resultado, reason ORDER BY eventos DESC;
