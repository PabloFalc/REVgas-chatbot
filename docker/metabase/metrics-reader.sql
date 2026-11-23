CREATE ROLE metrics_reader LOGIN PASSWORD :'pass' CONNECTION LIMIT 10;
ALTER ROLE metrics_reader SET statement_timeout = '10s';
GRANT CONNECT ON DATABASE :"DBNAME" TO metrics_reader;
GRANT USAGE ON SCHEMA public TO metrics_reader;
GRANT SELECT ON TABLE public.bot_events TO metrics_reader;
