-- Conversão por coorte de intenção: madura (>24 h) e total.
WITH intents AS (
  SELECT cycle_id, min(occurred_at) AS started_at
  FROM bot_events
  WHERE name = 'purchase_started'
    AND cycle_id IS NOT NULL
    AND occurred_at >= now() - make_interval(days => {{dias}})
    AND is_simulated = false
  GROUP BY cycle_id
), sales AS (
  SELECT DISTINCT cycle_id
  FROM sale_attempts
  WHERE status = 'registered' AND is_simulated = false
), scored AS (
  SELECT i.cycle_id, i.started_at, (s.cycle_id IS NOT NULL) AS converted,
         i.started_at <= now() - interval '24 hours' AS mature
  FROM intents i LEFT JOIN sales s USING (cycle_id)
)
SELECT
  count(*) FILTER (WHERE mature) AS intencoes_maduras,
  count(*) FILTER (WHERE mature AND converted) AS pedidos_em_intencoes_maduras,
  round(100.0 * count(*) FILTER (WHERE mature AND converted)
    / nullif(count(*) FILTER (WHERE mature), 0), 1) AS conversao_madura_pct,
  count(*) AS intencoes_totais,
  count(*) FILTER (WHERE converted) AS pedidos_em_intencoes_totais,
  round(100.0 * count(*) FILTER (WHERE converted) / nullif(count(*), 0), 1) AS conversao_total_pct
FROM scored;
