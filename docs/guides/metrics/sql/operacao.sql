SELECT name, outcome, reason, count(*) AS eventos, sum(amount) AS tentativas
FROM bot_events
WHERE occurred_at >= now() - make_interval(days => {{dias}}) AND name IN ('quantity_limit', 'order_status', 'cpf')
GROUP BY name, outcome, reason ORDER BY name, eventos DESC;
