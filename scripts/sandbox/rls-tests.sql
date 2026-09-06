-- ============================================================
-- Testes RLS cross-org — Fatia 2.1b passo 6
-- Usa SET LOCAL role authenticated + JWT claims completos:
--   sub, role, organization_id (usado por current_org_id())
-- Nunca usa service_role para provar isolamento.
--
-- Executar: psql "$SANDBOX_DB_URL" \
--   -v uid_admin_a=<UUID> -v uid_admin_b=<UUID> -f rls-tests.sql
-- ============================================================
\set ON_ERROR_STOP off
\set QUIET on

\if :{?uid_admin_a}
\else
  \set uid_admin_a '00000000-0000-0000-0000-000000000000'
  \warn 'Defina -v uid_admin_a=<UUID>'
\endif
\if :{?uid_admin_b}
\else
  \set uid_admin_b '00000000-0000-0000-0000-000000000000'
  \warn 'Defina -v uid_admin_b=<UUID>'
\endif

CREATE TEMP TABLE rls_results (test text, expected text, actual text, status text);

-- Helper: simula usuário autenticado com claims completos
CREATE OR REPLACE FUNCTION pg_temp.as_user(uid uuid, org uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object(
      'sub', uid::text,
      'role', 'authenticated',
      'aud', 'authenticated',
      'organization_id', org::text,
      'email', 'sandbox@sandbox.local'
    )::text, true);
END $$;

-- ============ Testes de leitura cross-org ============
BEGIN;
  SELECT pg_temp.as_user(:'uid_admin_a'::uuid, 'aaaa0000-0000-0000-0000-000000000001'::uuid);
  INSERT INTO rls_results
  SELECT 'admin_a vê exchanges de B', '0', count(*)::text,
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.exchanges WHERE organization_id = 'bbbb0000-0000-0000-0000-000000000001';
ROLLBACK;

BEGIN;
  SELECT pg_temp.as_user(:'uid_admin_a'::uuid, 'aaaa0000-0000-0000-0000-000000000001'::uuid);
  INSERT INTO rls_results
  SELECT 'admin_a vê vouchers de B', '0', count(*)::text,
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.exchange_vouchers WHERE organization_id = 'bbbb0000-0000-0000-0000-000000000001';
ROLLBACK;

BEGIN;
  SELECT pg_temp.as_user(:'uid_admin_a'::uuid, 'aaaa0000-0000-0000-0000-000000000001'::uuid);
  INSERT INTO rls_results
  SELECT 'admin_a vê store_credit de B', '0', count(*)::text,
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.store_credit_accounts WHERE organization_id = 'bbbb0000-0000-0000-0000-000000000001';
ROLLBACK;

BEGIN;
  SELECT pg_temp.as_user(:'uid_admin_a'::uuid, 'aaaa0000-0000-0000-0000-000000000001'::uuid);
  INSERT INTO rls_results
  SELECT 'admin_a vê exchange_receipts de B', '0', count(*)::text,
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.exchange_receipts WHERE organization_id = 'bbbb0000-0000-0000-0000-000000000001';
ROLLBACK;

BEGIN;
  SELECT pg_temp.as_user(:'uid_admin_a'::uuid, 'aaaa0000-0000-0000-0000-000000000001'::uuid);
  INSERT INTO rls_results
  SELECT 'admin_a vê sales de B', '0', count(*)::text,
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.sales WHERE organization_id = 'bbbb0000-0000-0000-0000-000000000001';
ROLLBACK;

BEGIN;
  SELECT pg_temp.as_user(:'uid_admin_a'::uuid, 'aaaa0000-0000-0000-0000-000000000001'::uuid);
  INSERT INTO rls_results
  SELECT 'admin_a vê variants de B', '0', count(*)::text,
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.product_variants WHERE organization_id = 'bbbb0000-0000-0000-0000-000000000001';
ROLLBACK;

-- ============ RPCs cross-org bloqueadas ============
BEGIN;
  SELECT pg_temp.as_user(:'uid_admin_a'::uuid, 'aaaa0000-0000-0000-0000-000000000001'::uuid);
  DECLARE v_err text := 'no_error';
  BEGIN
    PERFORM public.complete_exchange(jsonb_build_object(
      'location_id', (SELECT id FROM public.stock_locations WHERE organization_id = 'aaaa0000-0000-0000-0000-000000000001' LIMIT 1),
      'return_items', '[]'::jsonb, 'new_items', '[]'::jsonb,
      'payments', jsonb_build_array(jsonb_build_object(
        'direction','incoming','payment_method','exchange_voucher',
        'amount',10,'transaction_reference','SBX-B-VOUCHER'
      ))
    ));
    v_err := 'unexpected_success';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  INSERT INTO rls_results VALUES (
    'admin_a consome voucher de B via RPC',
    'erro (voucher não encontrado / bloqueado)', v_err,
    CASE WHEN v_err ILIKE '%vale%' OR v_err ILIKE '%voucher%' OR v_err ILIKE '%not_found%'
              OR v_err ILIKE '%permission%' OR v_err ILIKE '%organiz%'
         THEN 'PASS' ELSE 'FAIL' END
  );
ROLLBACK;

BEGIN;
  SELECT pg_temp.as_user(:'uid_admin_a'::uuid, 'aaaa0000-0000-0000-0000-000000000001'::uuid);
  DECLARE v_any uuid; v_err text := 'no_error';
  BEGIN
    SELECT id INTO v_any FROM public.exchanges
     WHERE organization_id = 'bbbb0000-0000-0000-0000-000000000001' LIMIT 1;
    IF v_any IS NULL THEN
      INSERT INTO rls_results VALUES ('reverse_exchange cross-org', 'sem dados de teste', 'skip', 'SKIP');
    ELSE
      BEGIN
        PERFORM public.reverse_exchange(v_any, 'sandbox');
        v_err := 'unexpected_success';
      EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
      END;
      INSERT INTO rls_results VALUES (
        'reverse_exchange cross-org', 'erro', v_err,
        CASE WHEN v_err <> 'unexpected_success' THEN 'PASS' ELSE 'FAIL' END
      );
    END IF;
  END;
ROLLBACK;

-- ============ Simetria: Admin B vs Org A ============
BEGIN;
  SELECT pg_temp.as_user(:'uid_admin_b'::uuid, 'bbbb0000-0000-0000-0000-000000000001'::uuid);
  INSERT INTO rls_results
  SELECT 'admin_b vê sales de A', '0', count(*)::text,
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.sales WHERE organization_id = 'aaaa0000-0000-0000-0000-000000000001';

  INSERT INTO rls_results
  SELECT 'admin_b vê vouchers de A', '0', count(*)::text,
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.exchange_vouchers WHERE organization_id = 'aaaa0000-0000-0000-0000-000000000001';
ROLLBACK;

\echo
\echo '=================== RLS TESTS ==================='
SELECT test, expected, actual, status FROM rls_results ORDER BY status DESC, test;
SELECT status, count(*) FROM rls_results GROUP BY status;
