WITH ciclos AS (
  SELECT cycle_id, min(occurred_at)::date AS dia,
    bool_or(name = 'turn' AND step IS NOT NULL) AS iniciou,
    bool_or(name = 'turn' AND step = 'summary') AS resumo,
    bool_or(name = 'sale' AND outcome = 'created') AS vendeu
  FROM bot_events
  WHERE occurred_at >= now() - make_interval(days => {{dias}}) AND cycle_id IS NOT NULL
  GROUP BY cycle_id
)
SELECT dia, count(*) FILTER (WHERE iniciou) AS ciclos,
  count(*) FILTER (WHERE iniciou AND resumo) AS resumos,
  count(*) FILTER (WHERE iniciou AND vendeu) AS vendas,
  round(100.0 * count(*) FILTER (WHERE iniciou AND vendeu) / nullif(count(*) FILTER (WHERE iniciou), 0), 2) AS conversao_percentual
FROM ciclos GROUP BY dia ORDER BY dia;
