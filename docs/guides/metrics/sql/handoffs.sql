SELECT name, outcome, reason, count(*) AS eventos FROM bot_events
WHERE occurred_at >= now() - make_interval(days => {{dias}}) AND name IN ('handoff', 'handoff_offered')
GROUP BY name, outcome, reason ORDER BY eventos DESC;
