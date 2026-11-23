SELECT outcome, reason, count(*) AS eventos FROM bot_events
WHERE occurred_at >= now() - make_interval(days => {{dias}}) AND name = 'sale'
GROUP BY outcome, reason ORDER BY eventos DESC;
