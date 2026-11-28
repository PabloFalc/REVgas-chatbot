-- Variáveis: dias (inteiro de 1 a 365; fora disso a consulta falha) e
-- incluir_simulados ('nao' por padrão ou 'sim'; qualquer outro valor exclui simulados).
-- Tentativas sem registro por estado e categoria de erro sanitizada (error_kind), sem texto de resposta externa.
SELECT status,
       error_kind,
       count(*) AS tentativas
FROM sale_attempts
WHERE created_at >= now() - make_interval(days => CASE WHEN {{dias}} BETWEEN 1 AND 365 THEN {{dias}} ELSE ('dias deve estar entre 1 e 365, recebido ' || {{dias}})::int END)
  AND status IN ('uncertain', 'failed', 'rejected')
  AND (is_simulated = false OR {{incluir_simulados}} = 'sim')
GROUP BY status, error_kind
ORDER BY tentativas DESC, status, error_kind;
