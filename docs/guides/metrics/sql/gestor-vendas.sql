-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- Pedidos registrados e valor em BRL. Depende de sale_attempts da Frente D.
WITH p AS (
  SELECT now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END) AS inicio
)
SELECT
  count(*) FILTER (WHERE sa.status = 'registered') AS pedidos_registrados,
  coalesce(sum(sa.total_cents) FILTER (WHERE sa.status = 'registered'), 0)::numeric / 100 AS valor_registrado_brl,
  CASE WHEN count(*) FILTER (WHERE sa.status = 'registered') = 0 THEN NULL
       ELSE (sum(sa.total_cents) FILTER (WHERE sa.status = 'registered'))::numeric
            / count(*) FILTER (WHERE sa.status = 'registered') / 100 END AS ticket_medio_brl,
  count(*) FILTER (WHERE sa.status = 'uncertain') AS resultado_incerto
FROM sale_attempts sa
CROSS JOIN p
WHERE sa.created_at >= p.inicio
  AND (sa.is_simulated = false OR {{incluir_simulados}} = 'sim');
