-- FATIA 2.1 — Passo 1 e 2: Hardening de permissões
-- 1) Restringir run_exchange_tests() a service_role
REVOKE ALL ON FUNCTION public.run_exchange_tests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_exchange_tests() FROM anon;
REVOKE ALL ON FUNCTION public.run_exchange_tests() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_exchange_tests() TO service_role;

-- 2) Bloquear CREATE no schema public para roles não-privilegiadas
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM authenticated;
-- postgres e service_role mantêm CREATE (owners/admin)
