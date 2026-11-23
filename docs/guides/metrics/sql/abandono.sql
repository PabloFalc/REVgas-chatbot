WITH eventos AS (
  SELECT * FROM bot_events WHERE occurred_at >= now() - make_interval(days => {{dias}})
), ultimos AS (
  SELECT DISTINCT ON (cycle_id) cycle_id, step, occurred_at
  FROM eventos WHERE name = 'turn' AND step IS NOT NULL AND cycle_id IS NOT NULL
  ORDER BY cycle_id, occurred_at DESC, id DESC
)
SELECT u.step,
  CASE WHEN u.step IN ('askName', 'askCpf', 'askCpfPrefix') THEN 'cadastro' ELSE 'pedido' END AS fase,
  CASE WHEN EXISTS (SELECT 1 FROM eventos e WHERE e.cycle_id = u.cycle_id AND e.name = 'reminder_sent') THEN 'com lembrete' ELSE 'sem lembrete' END AS lembrete,
  count(*) AS ciclos
FROM ultimos u
WHERE u.occurred_at < now() - interval '15 minutes'
  AND NOT EXISTS (SELECT 1 FROM eventos e WHERE e.cycle_id = u.cycle_id AND ((e.name = 'sale' AND e.outcome IN ('created', 'rejected')) OR (e.name = 'handoff' AND e.outcome IN ('queued', 'active')) OR e.name = 'order_cancelled'))
GROUP BY u.step, fase, lembrete ORDER BY ciclos DESC;
