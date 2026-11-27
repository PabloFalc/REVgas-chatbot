CREATE ROLE metrics_reader LOGIN PASSWORD :'pass' CONNECTION LIMIT 10;
ALTER ROLE metrics_reader SET statement_timeout = '10s';
GRANT CONNECT ON DATABASE :"DBNAME" TO metrics_reader;
GRANT USAGE ON SCHEMA public TO metrics_reader;
GRANT SELECT ON TABLE public.bot_events TO metrics_reader;
GRANT SELECT (id, cycle_id, status, total_cents, product_code, payment_method_code, customer_segment, error_kind, is_simulated, created_at, updated_at) ON TABLE public.sale_attempts TO metrics_reader;
