-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- Mix registrado por códigos de produto e pagamento.
SELECT product_code,
       payment_method_code,
       count(*) AS pedidos,
       coalesce(sum(total_cents), 0)::numeric / 100 AS valor_brl
FROM sale_attempts
WHERE status = 'registered'
  AND created_at >= now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END)
  AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
GROUP BY product_code, payment_method_code
ORDER BY pedidos DESC, product_code, payment_method_code;
